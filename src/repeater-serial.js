/**
 * Web Serial transport for MeshCore repeater / room server / sensor USB console.
 * Plain text lines terminated with CR; replies prefixed with "  -> ".
 */
(function (global) {
  "use strict";

  const MAX_LINE_LEN = 151;
  const DEFAULT_BAUD = 115200;
  const INTER_COMMAND_DELAY_MS = 150;
  const BOOT_DRAIN_MS = 500;
  const DISCONNECT_SETTLE_MS = 250;

  let port = null;
  let reader = null;
  let readLoopRunning = false;
  let readBuffer = "";
  let sendChain = Promise.resolve();
  let onDisconnectCb = null;
  let disconnectListener = null;
  let notifyingLost = false;

  function enqueueSend(task) {
    const run = sendChain.then(task);
    sendChain = run.catch(function () {
      /* keep queue alive after errors */
    });
    return run;
  }

  function isSupported() {
    return typeof navigator !== "undefined" && !!navigator.serial;
  }

  function sleep(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  /** True only while the Web Serial port streams are still open. */
  function isConnected() {
    return !!(port && port.readable && port.writable);
  }

  /**
   * Commands that reboot / wipe / enter modes that drop the USB link.
   * After these we clear local connection state so the UI cannot pretend
   * the previous session is still live.
   */
  function expectsDeviceDisconnect(line) {
    const cmd = String(line || "")
      .trim()
      .toLowerCase();
    return (
      cmd === "reboot" ||
      cmd === "erase" ||
      cmd === "start ota" ||
      cmd === "poweroff" ||
      cmd === "shutdown" ||
      cmd === "clkreboot"
    );
  }

  function setOnDisconnect(cb) {
    onDisconnectCb = typeof cb === "function" ? cb : null;
  }

  function detachDisconnectListener() {
    if (port && disconnectListener) {
      try {
        port.removeEventListener("disconnect", disconnectListener);
      } catch (_e) {
        /* ignore */
      }
    }
    disconnectListener = null;
  }

  /**
   * Tear down local port state and notify the UI. Safe to call repeatedly.
   * @param {string} [reason]
   */
  async function notifyConnectionLost(reason) {
    if (notifyingLost) return;
    notifyingLost = true;
    try {
      detachDisconnectListener();
      readLoopRunning = false;
      if (reader) {
        try {
          await reader.cancel();
        } catch (_e) {
          /* ignore */
        }
        reader = null;
      }
      if (port) {
        try {
          await port.close();
        } catch (_e) {
          /* ignore */
        }
        port = null;
      }
      readBuffer = "";
      if (onDisconnectCb) {
        try {
          onDisconnectCb(reason || "lost");
        } catch (_e) {
          /* ignore UI errors */
        }
      }
    } finally {
      notifyingLost = false;
    }
  }

  function isErrorReply(reply) {
    if (!reply) return false;
    return /^Err\b/i.test(reply) || /^Error/i.test(reply);
  }

  function commandTimeout(line) {
    if (line.startsWith("advert")) return 6000;
    if (line.startsWith("region save")) return 8000;
    if (line.startsWith("region ")) return 5000;
    return 4000;
  }

  function extractReply() {
    const m = readBuffer.match(/\r?\n\s*->\s*(.*?)(\r?\n|$)/);
    if (!m) return null;
    readBuffer = readBuffer.slice(m.index + m[0].length);
    return m[1].trim();
  }

  async function readLoop() {
    if (!port || !port.readable) return;
    readLoopRunning = true;
    reader = port.readable.getReader();
    const decoder = new TextDecoder();
    try {
      while (readLoopRunning) {
        const chunk = await reader.read();
        if (chunk.done) break;
        readBuffer += decoder.decode(chunk.value, { stream: true });
      }
    } catch (err) {
      if (readLoopRunning) {
        // Stream closed unexpectedly (unplug / reboot).
        notifyConnectionLost("read-error");
        return;
      }
    } finally {
      try {
        if (reader) reader.releaseLock();
      } catch (_e) {
        /* ignore */
      }
      reader = null;
      readLoopRunning = false;
    }
  }

  function waitForReply(timeoutMs) {
    return new Promise(function (resolve) {
      const deadline = Date.now() + timeoutMs;
      function tick() {
        if (!isConnected()) {
          resolve("");
          return;
        }
        const reply = extractReply();
        if (reply !== null) {
          resolve(reply);
          return;
        }
        if (Date.now() >= deadline) {
          resolve("");
          return;
        }
        setTimeout(tick, 50);
      }
      tick();
    });
  }

  async function connect(options) {
    if (!isSupported()) {
      throw new Error("Web Serial is not supported in this browser.");
    }
    await disconnect();
    port = await navigator.serial.requestPort({ filters: [] });
    await port.open({
      baudRate: (options && options.baudRate) || DEFAULT_BAUD,
    });
    readBuffer = "";
    disconnectListener = function () {
      notifyConnectionLost("device-disconnect");
    };
    port.addEventListener("disconnect", disconnectListener);
    readLoop().catch(function () {
      /* disconnect races */
    });
    await sleep(BOOT_DRAIN_MS);
    readBuffer = "";
    return true;
  }

  async function disconnect() {
    detachDisconnectListener();
    readLoopRunning = false;
    if (reader) {
      try {
        await reader.cancel();
      } catch (_e) {
        /* ignore */
      }
    }
    if (port) {
      try {
        await port.close();
      } catch (_e) {
        /* ignore */
      }
      port = null;
    }
    readBuffer = "";
  }

  /**
   * Verify the port is still usable before a serial action.
   * Returns true if connected; otherwise clears stale state and returns false.
   */
  async function ensureConnected() {
    if (isConnected()) return true;
    if (port) {
      await notifyConnectionLost("stale");
    }
    return false;
  }

  async function writeRaw(text) {
    if (!(await ensureConnected())) {
      throw new Error("Serial port is not connected.");
    }
    let writer;
    try {
      writer = port.writable.getWriter();
      await writer.write(new TextEncoder().encode(text));
    } catch (err) {
      await notifyConnectionLost("write-error");
      throw new Error(
        "Serial connection lost" +
          (err && err.message ? ": " + err.message : "."),
      );
    } finally {
      if (writer) {
        try {
          writer.releaseLock();
        } catch (_e) {
          /* ignore */
        }
      }
    }
  }

  async function sendLine(line, options) {
    return enqueueSend(async function () {
      const trimmed = String(line || "").trim();
      if (!trimmed) {
        return { ok: true, reply: "" };
      }
      if (!(await ensureConnected())) {
        throw new Error("Serial port is not connected.");
      }
      if (trimmed.length > MAX_LINE_LEN) {
        throw new Error(
          "Line too long (" +
            trimmed.length +
            " > " +
            MAX_LINE_LEN +
            "): " +
            trimmed.slice(0, 48) +
            "…",
        );
      }
      const willDisconnect = expectsDeviceDisconnect(trimmed);
      const timeoutMs =
        (options && options.timeoutMs) ||
        (willDisconnect ? 2000 : commandTimeout(trimmed));
      await writeRaw(trimmed + "\r");
      if (willDisconnect) {
        // Device is about to drop USB — do not wait for a full reply window.
        await sleep(DISCONNECT_SETTLE_MS);
        await notifyConnectionLost("command:" + trimmed.split(/\s+/)[0]);
        return { ok: true, reply: "", disconnected: true };
      }
      const reply = await waitForReply(timeoutMs);
      if (!isConnected()) {
        await notifyConnectionLost("lost-during-reply");
        throw new Error("Serial connection lost while waiting for reply.");
      }
      if (isErrorReply(reply)) {
        return { ok: false, reply: reply, error: reply };
      }
      return { ok: true, reply: reply };
    });
  }

  async function runCommandBatch(lines, options) {
    const onProgress = (options && options.onProgress) || function () {};
    const signal = options && options.signal;
    const stopOnError = Boolean(options && options.stopOnError);
    const results = [];
    const total = lines.length;

    for (let i = 0; i < lines.length; i++) {
      if (signal && signal.aborted) {
        throw new DOMException("Cancelled.", "AbortError");
      }
      if (!(await ensureConnected())) {
        const err = new Error("Serial connection lost.");
        err.index = i;
        throw err;
      }
      const line = String(lines[i] || "").trim();
      if (!line || line.charAt(0) === "#") {
        continue;
      }
      onProgress({
        phase: "sending",
        index: i,
        total: total,
        line: line,
      });
      const result = await sendLine(line);
      const entry = { line: line, ok: result.ok, reply: result.reply };
      results.push(entry);
      onProgress({
        phase: "done",
        index: i,
        total: total,
        line: line,
        ok: result.ok,
        reply: result.reply,
        error: result.error,
      });
      if (!result.ok && stopOnError) {
        const err = new Error(result.error || "Command failed.");
        err.line = line;
        err.index = i;
        throw err;
      }
      await sleep(INTER_COMMAND_DELAY_MS);
    }
    return results;
  }

  async function applyCommands(lines, options) {
    return runCommandBatch(lines, Object.assign({}, options, { stopOnError: true }));
  }

  async function queryCommands(lines, options) {
    return runCommandBatch(lines, Object.assign({}, options, { stopOnError: false }));
  }

  global.RepeaterSerial = {
    isSupported: isSupported,
    isConnected: isConnected,
    ensureConnected: ensureConnected,
    expectsDeviceDisconnect: expectsDeviceDisconnect,
    setOnDisconnect: setOnDisconnect,
    connect: connect,
    disconnect: disconnect,
    sendLine: sendLine,
    applyCommands: applyCommands,
    queryCommands: queryCommands,
    MAX_LINE_LEN: MAX_LINE_LEN,
    DEFAULT_BAUD: DEFAULT_BAUD,
  };
})(typeof window !== "undefined" ? window : globalThis);
