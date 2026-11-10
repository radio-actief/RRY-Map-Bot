import { render } from "preact";
import { App } from "./app/App";
import { loadSiteTools } from "./app/pages";
import { I18N, setLang } from "./i18n/t";
import "./theme/app.css";

void loadSiteTools();

/* English is bundled; Dutch or French loads first, so the first paint is already in the page language. */
void setLang(I18N.lang)
  .catch(() => setLang("en"))
  .then(() => render(<App />, document.getElementById("app")!));
