---
name: report-builder
description: 在任务进入交付或总结阶段时使用。基于已验证事实整理结果、验证、风险和后续动作，输出可直接给用户阅读的交付说明，并明确禁止编造未验证结论。
---
# Delivery Report

## Overview

本 skill 用于把执行结果整理成交付说明。它关注的是：基于证据总结事实、说明验证范围、标出风险和下一步，而不是把过程日志原样贴给用户。

## When to use

- 任务进入收尾或交付阶段，需要给用户一份清晰的结果说明。
- 需要把变更、验证、风险和后续动作整理成可直接阅读的输出。
- 用户明确要求“总结一下”“整理成交付说明”“给我最终报告”。

## Preconditions

- 先确认哪些事实已经执行并验证，哪些仍是风险或未验证项。
- 报告应基于真实命令结果、代码改动、检查结论或用户确认，不要凭印象总结。
- 交付前参考 [delivery-structure.md](references/delivery-structure.md) 组织结构。

## Core Workflow

1. **Collect evidence.**
   - 汇总真实完成的改动、执行过的验证、阻塞和残留风险。
   - 先区分“已完成”“已验证”“未验证”“阻塞中”。
2. **Compress the change set.**
   - 把用户真正关心的结果放在前面，用最少必要细节说明产出。
   - 如果改动很多，按用户可理解的结果分组，而不是机械列文件清单。
3. **Report validation honestly.**
   - 写清楚跑了什么测试 / 检查，结果如何。
   - 没跑到的内容必须明确标成未验证，不要藏起来。
4. **Surface risk and next steps.**
   - 把剩余风险、环境限制、待确认项和建议后续动作单列。
   - 如果已经完全收口，也要说明验证边界。
5. **Tailor for the user.**
   - 默认面向最终用户或需求方，语言简洁直接。
   - 除非用户要求详细过程，否则不要堆日志和实现细节。

## Guardrails

- 不要编造未执行的命令、未验证的结论或不存在的效果。
- 不要把风险写成“已解决”。
- 不要用长篇 changelog 代替结果导向的总结。
- 不要省略关键阻塞和未验证区域。

## Validation

- 检查每个结论是否能对应到真实证据。
- 检查“结果 / 验证 / 风险 / 下一步”四类信息是否都齐全。
- 检查表述是否清楚区分了已完成和仍有风险。
- 交付前用 [delivery-structure.md](references/delivery-structure.md) 复核输出结构。

## References

- [delivery-structure.md](references/delivery-structure.md): 交付报告的推荐结构与信息取舍原则。
