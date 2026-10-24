import { render } from "preact";
import { App } from "./app/App";
import "./theme/app.css";

render(<App />, document.getElementById("app")!);
