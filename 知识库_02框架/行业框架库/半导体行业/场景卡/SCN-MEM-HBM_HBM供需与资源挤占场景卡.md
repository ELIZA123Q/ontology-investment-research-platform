---
document_type: semiconductor_scenario_card
scenario_id: SCN-MEM-HBM
name: HBM供需与资源挤占场景卡
scenario_kind: product_tech
default_framework_id: IF-SC-01
scenario_type: product_application
version: 2.1.0
status: scenario
updated_at: 2026-07-14
---

# HBM供需与资源挤占场景卡

## 决胜分歧

HBM 有效供给由 die、堆叠、封装、测试、良率、客户认证与**代际切换生产率**共同决定；晶圆容量不是充分指标。即使晶圆投入不变，代际（HBM3E/HBM4）、die 尺寸、堆叠层数、单片有效 die、新代际良率与测试时间也会改变有效 bit 供给。

## 1. 本场景相对于主框架增加什么

相对 IF-SC-01，本卡增加：

1. HBM 独立供给链（die/堆叠/封装/测试/认证）；
2. 代际切换生产率（层数、die 尺寸、有效 die、良率学习、测试节拍）；
3. DRAM 晶圆与封装资源对通用 DRAM 的挤占。

## 2. 调用路由

| 项目 | 内容 |
|---|---|
| 默认主框架 | IF-SC-01 |
| 条件辅助框架 | 堆叠封装测试→IF-PKG；晶圆 die 良率→IF-FAB；AI 系统需求→IF-APP |
| 默认排除 | DES/EQP/MAT 除非已定位具体瓶颈 |
| 不适用问题 | 纯通用 DRAM 周期（用 SCN-MEM-CYCLE） |

## 3. 场景特有判断脊柱

```text
AI系统真实需求与代际认证
→ DRAM合格晶圆投入
→ 代际切换生产率（层数/die/良率/测试）
→ 堆叠/封装/测试有效供给
→ HBM兑现与通用DRAM资源挤占
```

## 4. 场景增量变量与竞争解释

| 决胜变量 | 主解释成立时 | 竞争解释成立时 | 最低验证 |
|---|---|---|---|
| 有效供给 | 认证+合格产出+代际生产率同步 | 约束在封装/测试或代际切换 | 分工序+代际参数 |
| 真实需求 | 系统部署驱动消耗 | 长协锁单≠消耗 | 加速卡交付+部署 |
| 资源挤占 | HBM外溢通用DRAM | 紧缺未外溢 | 晶圆投入+产品组合 |
| 代际生产率 | 同投入有效bit升/降可解释 | 只用晶圆产能比跨代 | 层数/die/良率/测试时间 |

## 5. 对 02 和 03 的增量交接

```yaml
scenario_additions:
  required_splits:
    - HBM / 通用DRAM
    - 现货 / 合约 / 实现价
    - 晶圆 / 堆叠 / 封装 / 测试 / 认证 / 代际生产率
  mandatory_evidence:
    - 分客户代际认证与长协
    - 代际参数：层数、die尺寸、有效die、良率、测试节拍
    - 堆叠/封装/测试产能与交期
  counter_evidence:
    - 部署受限
    - 代际切换拖累有效bit
    - 约束在封装非晶圆
  stop_if:
    - 无法区分HBM与通用DRAM
    - 跨代际仅用晶圆产能外推
```
