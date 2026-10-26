/**
 * 壁纸。毛玻璃必须有东西可以模糊，否则就是一块灰。
 *
 * 三团雾斑固定在最底层、不随页面滚动——滚动时玻璃下面的颜色缓缓移动，
 * 这是 macOS 毛玻璃最有质感的地方（静态截图看不出来，用起来能感觉到）。
 * 漂移动画 38~46 秒一个来回，肉眼几乎察觉不到在动。
 *
 * 颜色全部来自主题令牌（--wall-1/2/3），所以三套主题共用这一份标记。
 * 登录页没有外层 AppShell，所以抽成组件而不是写在 shell 里。
 */
export function Wallpaper() {
  return (
    <div className="app-wallpaper" aria-hidden>
      <span className="w-blob w-blob-1" />
      <span className="w-blob w-blob-2" />
      <span className="w-blob w-blob-3" />
    </div>
  );
}
