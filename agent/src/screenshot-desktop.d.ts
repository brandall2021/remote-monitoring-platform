declare module "screenshot-desktop" {
  interface ScreenshotDesktopOptions {
    format?: "png" | "jpg";
    screen?: number;
  }

  export default function screenshot(
    options?: ScreenshotDesktopOptions
  ): Promise<Buffer>;
}
