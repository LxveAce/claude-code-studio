declare module '*.css' {
  const content: Record<string, string>;
  export default content;
}

declare module 'node-pty' {
  export interface IPty {
    pid: number;
    onData(callback: (data: string) => void): void;
    onExit(callback: (e: { exitCode: number }) => void): void;
    write(data: string): void;
    resize(cols: number, rows: number): void;
    kill(): void;
  }

  export function spawn(
    file: string,
    args: string[],
    options: {
      name?: string;
      cols?: number;
      rows?: number;
      cwd?: string;
      env?: Record<string, string>;
    }
  ): IPty;
}
