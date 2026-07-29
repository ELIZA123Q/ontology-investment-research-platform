"use client";

import { useRouter } from "next/navigation";
import { forwardRef,useCallback,useEffect,useImperativeHandle,useMemo,useState } from "react";
import { asItemList } from "./helpers";

function parseScopeJson(existingJson: string | undefined, question: string) {
  let existing: any = {};
  try { existing = JSON.parse(existingJson || "{}"); } catch { existing = {}; }
  return {
    normalizedQuestion: String(existing.normalized_question || question || ""),
    coreObject: String(existing.core_object || ""),
    judgmentAction: String(existing.judgment_action || ""),
    lookback: String(existing.time_scope?.lookback || ""),
    asOf: String(existing.time_scope?.as_of || ""),
    forward: String(existing.time_scope?.forward || ""),
    boundaries: asItemList(existing.boundaries, 2),
    exclusions: asItemList(existing.exclusions, 1),
  };
}

export type ControlledScopeProjectionFormHandle = {
  save: () => Promise<boolean>;
};

export const ControlledScopeProjectionForm = forwardRef<ControlledScopeProjectionFormHandle, {
  runId: string;
  question: string;
  existingJson?: string;
  enabled: boolean;
  onBusyChange?: (busy: boolean) => void;
  onError?: (error: string) => void;
}>(function ControlledScopeProjectionForm({ runId, question, existingJson, enabled, onBusyChange, onError }, ref) {
  const router = useRouter();
  const seed = useMemo(() => parseScopeJson(existingJson, question), [existingJson, question]);
  const [normalizedQuestion, setNormalizedQuestion] = useState(seed.normalizedQuestion);
  const [coreObject, setCoreObject] = useState(seed.coreObject);
  const [judgmentAction, setJudgmentAction] = useState(seed.judgmentAction);
  const [lookback, setLookback] = useState(seed.lookback);
  const [asOf, setAsOf] = useState(seed.asOf);
  const [forward, setForward] = useState(seed.forward);
  const [boundaries, setBoundaries] = useState<string[]>(seed.boundaries);
  const [exclusions, setExclusions] = useState<string[]>(seed.exclusions);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const next = parseScopeJson(existingJson, question);
    setNormalizedQuestion(next.normalizedQuestion);
    setCoreObject(next.coreObject);
    setJudgmentAction(next.judgmentAction);
    setLookback(next.lookback);
    setAsOf(next.asOf);
    setForward(next.forward);
    setBoundaries(next.boundaries);
    setExclusions(next.exclusions);
    setMessage("");
  }, [existingJson, question]);

  const submit = useCallback(async () => {
    const scope = {
      normalized_question: normalizedQuestion.trim(),
      core_object: coreObject.trim(),
      judgment_action: judgmentAction.trim(),
      lookback: lookback.trim(),
      as_of: asOf.trim(),
      forward: forward.trim(),
      boundaries: boundaries.map((item) => item.trim()).filter(Boolean),
      exclusions: exclusions.map((item) => item.trim()).filter(Boolean),
    };
    if (!scope.normalized_question || !scope.core_object || !scope.judgment_action || !scope.lookback || !scope.as_of || !scope.forward || scope.boundaries.length < 2 || !scope.exclusions.length) {
      const hint = "请按四层补全：研究问题、对象与判断动作、时间三件套；边界至少两条，排除项至少一条。";
      setMessage(hint);
      onError?.(hint);
      return false;
    }
    setBusy(true);
    onBusyChange?.(true);
    setMessage("");
    try {
      const response = await fetch(`/api/runs/${runId}/stages/01/generate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "deterministic_projection", scope }),
      });
      const result = await response.json();
      if (!response.ok) {
        const error = result.error || "研究范围保存失败";
        setMessage(error);
        onError?.(error);
        return false;
      }
      setMessage("研究范围已写入后台；可读稿已同步，请审阅后确认。");
      router.refresh();
      return true;
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      setMessage(text);
      onError?.(text);
      return false;
    } finally {
      setBusy(false);
      onBusyChange?.(false);
    }
  }, [
    normalizedQuestion, coreObject, judgmentAction, lookback, asOf, forward, boundaries, exclusions,
    runId, router, onBusyChange, onError,
  ]);

  useImperativeHandle(ref, () => ({ save: submit }), [submit]);

  const locked = !enabled || busy;

  return <div className="scope-form">
    <p className="scope-form-lead">按四层填写：研究问题 → 判断对象与动作 → 时间框 → 边界。这里只定义任务，不写事实或结论。</p>

    <section className="scope-block">
      <header className="scope-block-head">
        <strong>1. 研究问题</strong>
        <span>整次任务要回答的完整问句</span>
      </header>
      <div className="field">
        <label>改写后的研究问题</label>
        <textarea value={normalizedQuestion} disabled={locked} onChange={(event) => setNormalizedQuestion(event.target.value)} placeholder="写成可验证、可反证的完整问句；后续阶段不得偷换此题" />
      </div>
    </section>

    <section className="scope-block">
      <header className="scope-block-head">
        <strong>2. 判断什么</strong>
        <span>把问题拆成「对象」和「动作」</span>
      </header>
      <div className="scope-pair">
        <div className="field">
          <div className="field-meta">
            <label>核心对象与口径</label>
            <span className="field-hint">判断谁；有比较则写清比较对象</span>
          </div>
          <textarea value={coreObject} disabled={locked} onChange={(event) => setCoreObject(event.target.value)} placeholder="例如：全球存储芯片中的 HBM、非 HBM DRAM、NAND" />
        </div>
        <div className="field">
          <div className="field-meta">
            <label>判断动作</label>
            <span className="field-hint">对对象做什么判断</span>
          </div>
          <textarea value={judgmentAction} disabled={locked} onChange={(event) => setJudgmentAction(event.target.value)} placeholder="例如：定位周期阶段，并给出延续/转向的条件" />
        </div>
      </div>
    </section>

    <section className="scope-block">
      <header className="scope-block-head">
        <strong>3. 时间框</strong>
        <span>截止时点是「现在」；回看/前瞻都相对它</span>
      </header>
      <div className="scope-time">
        <div className="field">
          <div className="field-meta">
            <label>回看期</label>
            <span className="field-hint">从截止时点往回看多远</span>
          </div>
          <textarea className="scope-compact" value={lookback} disabled={locked} onChange={(event) => setLookback(event.target.value)} placeholder="例如：最近六个完整季度" />
        </div>
        <div className="field scope-time-anchor">
          <div className="field-meta">
            <label>截止时点（当前锚点）</label>
            <span className="field-hint">只用到这一天（含）已公开信息</span>
          </div>
          <textarea className="scope-compact" value={asOf} disabled={locked} onChange={(event) => setAsOf(event.target.value)} placeholder="例如：2025年上半年" />
        </div>
        <div className="field">
          <div className="field-meta">
            <label>前瞻期</label>
            <span className="field-hint">从截止时点往前看多远</span>
          </div>
          <textarea className="scope-compact" value={forward} disabled={locked} onChange={(event) => setForward(event.target.value)} placeholder="例如：未来 6—24 个月" />
        </div>
      </div>
    </section>

    <section className="scope-block">
      <header className="scope-block-head">
        <strong>4. 边界</strong>
        <span>边界写本次要做的；排除项写明确不做的</span>
      </header>
      <div className="scope-pair">
        <div className="field">
          <div className="field-meta">
            <label>研究边界</label>
            <span className="field-hint">每条一个输入框 · 至少两条</span>
          </div>
          <div className="scope-item-list">
            {boundaries.map((item, index) => (
              <div className="scope-item-row" key={`boundary-${index}`}>
                <textarea
                  className="scope-item-input"
                  value={item}
                  disabled={locked}
                  onChange={(event) => setBoundaries(boundaries.map((value, itemIndex) => itemIndex === index ? event.target.value : value))}
                  placeholder={index === 0 ? "例如：只判断行业供需与产品价格周期" : "再写一条边界"}
                />
                <button
                  type="button"
                  className="button-quiet"
                  disabled={locked || boundaries.length <= 2}
                  onClick={() => setBoundaries(boundaries.filter((_, itemIndex) => itemIndex !== index))}
                >删除</button>
              </div>
            ))}
            <button type="button" className="button-secondary scope-item-add" disabled={locked} onClick={() => setBoundaries([...boundaries, ""])}>＋ 添加边界</button>
          </div>
        </div>
        <div className="field">
          <div className="field-meta">
            <label>排除项</label>
            <span className="field-hint">每条一个输入框 · 至少一条</span>
          </div>
          <div className="scope-item-list">
            {exclusions.map((item, index) => (
              <div className="scope-item-row" key={`exclusion-${index}`}>
                <textarea
                  className="scope-item-input"
                  value={item}
                  disabled={locked}
                  onChange={(event) => setExclusions(exclusions.map((value, itemIndex) => itemIndex === index ? event.target.value : value))}
                  placeholder={index === 0 ? "例如：不做个股评级或目标价" : "再写一条排除项"}
                />
                <button
                  type="button"
                  className="button-quiet"
                  disabled={locked || exclusions.length <= 1}
                  onClick={() => setExclusions(exclusions.filter((_, itemIndex) => itemIndex !== index))}
                >删除</button>
              </div>
            ))}
            <button type="button" className="button-secondary scope-item-add" disabled={locked} onClick={() => setExclusions([...exclusions, ""])}>＋ 添加排除项</button>
          </div>
        </div>
      </div>
    </section>

    {message ? <div className="notice">{message}</div> : null}
  </div>;
});
