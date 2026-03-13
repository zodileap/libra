---
name: test-runner
description: 在功能实现、缺陷修复或回归验证阶段使用。选择最相关的测试集合执行，记录结果、定位失败原因、说明回归范围，并在无法执行时明确阻塞与风险。
---
# Test Execution

## Overview

本 skill 用于把“验证”这件事做完整：选测试、执行测试、读取结果、定位问题、定义回归范围，并把能验证与不能验证的边界讲清楚。

## When to use

- 功能实现完成，需要进行单元、UI、集成或 Desktop E2E 验证。
- 缺陷修复后，需要确认问题消失且没有引入明显回归。
- 用户明确要求“跑测试”“验证一下”“给我失败定位和风险说明”。

## Preconditions

- 先看改动范围和风险面，再决定要跑哪类测试；不要一上来默认全量测试。
- 确认当前仓库测试入口、命令和运行前提；需要时读取 [desktop-test-matrix.md](references/desktop-test-matrix.md)。
- 如果测试依赖服务、环境变量、二进制或 Tauri 容器，先确认这些前提是否可用。

## Core Workflow

1. **Choose the smallest relevant test set.**
   - 先按改动面选择最相关的单元、UI、集成或 E2E 测试。
   - 只有当局部测试不足以覆盖风险时，才扩大测试范围。
2. **Run and capture evidence.**
   - 执行真实命令，保留关键输出、失败栈、断言信息和环境阻塞说明。
   - 如果命令失败，先区分是测试失败、编译失败还是环境失败。
3. **Diagnose the first meaningful issue.**
   - 优先解释第一个新的、直接阻塞结论的问题。
   - 给出失败归因、影响范围、可能修复方向和是否需要进一步验证。
4. **Define regression scope.**
   - 说明哪些路径已经验证、哪些相关路径仍有风险、是否还需要补跑其他测试。
   - 对于没跑到的高风险区域，要显式标注为未验证。
5. **Report honestly.**
   - 把实际执行过的命令、结果、失败原因、阻塞条件和风险清楚写出。
   - 无法执行时，停在阻塞说明，不要编造通过结果。

## Guardrails

- 不要把“没有运行”说成“理论通过”。
- 不要只贴命令，不解释结果。
- 不要为了节省时间跳过最直接相关的测试集合。
- 不要把环境阻塞和代码失败混为一谈。

## Validation

- 检查最终结论是否与实际执行结果一致。
- 检查是否明确区分了：通过、失败、阻塞、未执行。
- 检查失败归因是否基于真实日志，而不是猜测。
- 交付前对照 [desktop-test-matrix.md](references/desktop-test-matrix.md)，确认测试层级选型正确。

## References

- [desktop-test-matrix.md](references/desktop-test-matrix.md): Desktop 各类测试层的适用边界与典型场景。
