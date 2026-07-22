export default function RunLoading() {
  return (
    <div className="run-loading" aria-busy="true" aria-label="页面加载中">
      <div className="run-loading-bar" />
      <div className="run-loading-copy">
        <span>加载研究场景…</span>
        <p className="muted">导航已固定；仅刷新本页内容。</p>
      </div>
    </div>
  );
}
