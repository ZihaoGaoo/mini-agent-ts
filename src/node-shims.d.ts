declare const __dirname: string;
declare const console: {
  log: (...args: any[]) => void;
  error: (...args: any[]) => void;
};
declare const process: {
  argv: string[];
  cwd: () => string;
  exit: (code?: number) => never;
  stdin: any;
  stdout: any;
};

declare module "node:fs/promises" {
  const fs: any;
  export = fs;
}

declare module "node:path" {
  const path: any;
  export = path;
}

declare module "node:http" {
  const http: any;
  export = http;
}

declare module "node:crypto" {
  const crypto: any;
  export = crypto;
}

declare module "node:child_process" {
  const childProcess: any;
  export = childProcess;
}

declare module "node:util" {
  const util: any;
  export = util;
}

declare module "node:readline/promises" {
  const readline: any;
  export = readline;
}
