import { register } from "node:module";
register(new URL("./import-meta-url.js", import.meta.url));
