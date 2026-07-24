declare module "node:net" {
  export interface Server {
    once(event: "error", listener: (error: Error) => void): this;
    listen(path: string, listeningListener?: () => void): this;
    close(callback?: (error?: Error) => void): this;
  }

  export function createServer(): Server;
}
