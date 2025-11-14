declare module "formidable" {
  import type { IncomingMessage } from "http";

  export interface Fields {
    [key: string]: string | string[];
  }

  export interface File {
    filepath: string;
    originalFilename?: string | null;
    newFilename?: string;
    mimetype?: string | null;
    size: number;
    hash?: string | null;
  }

  export interface Files {
    [key: string]: File | File[];
  }

  export interface Options {
    multiples?: boolean;
    maxFileSize?: number;
    keepExtensions?: boolean;
  }

  export interface Formidable {
    parse(
      req: IncomingMessage,
      callback: (err: any, fields: Fields, files: Files) => void,
    ): void;
  }

  export function formidable(options?: Options): Formidable;
  export { File, Fields, Files };
}

