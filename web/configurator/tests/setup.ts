/**
 * Test setup for every file: the Apply and Read tests run whole command sequences against a fake
 * repeater, which can take over a second on a busy CI runner, so findBy/waitFor wait up to 5 s.
 */
import { configure } from "@testing-library/preact";

configure({ asyncUtilTimeout: 5000 });
