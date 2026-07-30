# AP 调度算法瓶颈分析

> 排课系统当前状态：G10 完美求解（CP-SAT OPTIMAL），G11/G12 教学班层完美求解（CP-SAT OPTIMAL），但 G11/G12 的 AP 选修层**无法在全员选课场景下产出合法课表**。

---

## 一、业务约束

学校正常状态：**每位 G11/G12 学生选修 3 门 AP 课**，每门每周 5 课时。以 G11 为例：

| AP 课程 | 教师 | 选课人数 |
|---|---|---|
| AP_PHYS2 | T_ZHANGZUOPING | 27 人 |
| AP_CHEM | T_YANGHONGXU | 26 人 |
| AP_BIO | T_FANZHENGWEI | 27 人 |
| AP_CS | T_SUNHUA | 27 人 |
| AP_PSYCH | T_FUXIAOMENG | 26 人 |
| AP_ENVSCI | T_ZHUJIE | 27 人 |
| AP_MACRO | T_QINXINXUAN | 27 人 |
| AP_ARTHIST | T_ZHANGHUIHUI | 26 人 |
| AP_MICRO | T_GLENN | 27 人 |

**关键数字**：每位教师最多同时在 1 个时段上课，每周 50 个时段。27 人选同一门 AP × 5 课时 = **135 学生-课时需求**，而教师只有 50 个时段容量。物理上要求该教师在 5 天内为 27 个学生每人安排 5 节课，这是可行的——只要每节课同时教多个学生（教学班模式），而非一对一排课。

---

## 二、当前算法架构

G11 求解分三个阶段：

```
Phase 1: Admin 固定时段（行政班互换）
Phase 2: CP-SAT 联合求解 3 个教学班（ENG_COMP, AP_CALC_BC 等）→ OPTIMAL ✅
Phase 3: logic-solver 逐学生 SAT 排 AP 选修 → 瓶颈 ❌
```

**Phase 3 的关键代码**（`cpsat-g11-engine.cjs` L196-218）：

```js
// 对每个学生串行处理
this.students.forEach(stu => {
  const apCourses = apList.map(cid => [cid, 5, apCfg[cid]]);
  // 构建该学生的 logic-solver 实例
  const lsolver = new Logic.Solver();
  // 为每门 AP 的每个课时创建变量
  for (const [cid, hrs, tid] of apCourses) {
    for (let h = 0; h < hrs; h++) {
      for (const sid of allSlots) {
        // 仅检查"当前已有 assignments 中该教师是否被占用"
        if (tid && A.some(x => x.teacher_id === tid && x.slot_id === sid 
            && x.student_id !== stu.id)) continue;
        sv[sid] = `ap_${cid}_${h}_${sid}`;
      }
    }
  }
  const solution = lsolver.solve();
  if (!solution) {
    // fallback: 贪心逐时段塞，教师检查更弱
  }
});
```

**问题链条**：

1. 学生 S1 排 AP_PHYS2 → SAT 找到 5 个时段，教师 T_ZHANGZUOPING 的这 5 个时段被占用
2. 学生 S2 排 AP_PHYS2 → SAT 搜索时排除 T_ZHANGZUOPING 已占用的时段，可用时段变少
3. 学生 S10 排 AP_PHYS2 → 教师已被占用 50 个时段，**SAT 无解 → fallback**
4. fallback 贪心放置同样因教师冲突失败 → **该生 AP 课只能排出 0-2 节**

---

## 三、根因：学生串行 × 教师单时段容量 = 先到先得的饥饿问题

逐学生串行 SAT 的本质是**贪心**——先排的学生占满最优时段，后到的学生饿死。这不是 bug，而是架构在全员选课场景下的必然结果。

对比三个年级的做法：

| 年级 | 课程层 | 求解方式 | 是否全局协调教师 |
|---|---|---|---|
| G10 | 教学班课（37 课时） | 3 TC 联合 CP-SAT | ✅ 是——所有 TC 的教师约束在同一模型中 |
| G11 | 教学班课（18 课时） | 3 TC 联合 CP-SAT | ✅ 是 |
| G11 | **AP 选修（5 课时×3 门）** | **逐学生串行 SAT** | ❌ 否——学生之间不协调 |
| G12 | 教学班课（16 课时） | 3 TC 联合 CP-SAT | ✅ 是 |
| G12 | **AP+选修（5+4+2 课时）** | **逐学生串行 SAT** | ❌ 否 |

G10 成功的原因：所有课程都在 Phase 2 的联合 CP-SAT 中求解，**不存在逐学生串行阶段**。G11/G12 教学班层成功也是同理。

---

## 四、修复方向

### 方案 A：按 AP 课程分组联合 CP-SAT（推荐）

将选同一门 AP 的所有学生作为一个整体，构建 CP-SAT 模型：

```
对于每门 AP 课程（如 AP_PHYS2，27 人选）：
  - 每个学生 5 个 BoolVar 组（每人 5 个时段）
  - 跨学生约束：同一教师同一时段 ≤ 1（教师物理约束）
  - 每生每日 ≤ 1 节同课（≤5hr 分布约束）
  - 每生时段不重叠（学生约束）
  - 目标：最小化自习上午化
```

**优点**：CP-SAT 能全局搜索 27 个学生的时段分配，不会出现饥饿。**与 G10/G11/G12 已有的 CP-SAT 模式完全一致。**

**工作量**：约 200-300 行代码，替换 G11 Phase 3 和 G12 Phase 4 的逐学生 SAT 部分。

### 方案 B：多轮迭代 + 教师时段配额

保持逐学生 SAT，但增加：
- 预处理：计算每位教师的总需求和可用时段比例
- 为每个学生随机打乱处理顺序（而非固定顺序）
- 多轮 bestOfN：选教师冲突最少的一轮

**优点**：改动小（约 50 行）。

**缺点**：治标不治本——配额分配是启发式的，极端场景下仍然可能无解。文档 2 已明确指出"bestOfN 50 轮也选不出干净解"。

---

## 五、参考

- 文档 2 PR3「G12 AP/选修教师关联组件 CP-SAT」提出了相同的方案 A 方向
- Code Review 报告 P1-1 指出 evaluate() 无冲突惩罚 → bestOfN 无法筛选带冲突解（已修复）
- 当前 G10 联合 CP-SAT 的成功验证了方案 A 的技术可行性

---

*分析日期：2026-07-30 · 数据基线：真实模拟数据 240 人（G10=80, G11=80, G12=80）*
