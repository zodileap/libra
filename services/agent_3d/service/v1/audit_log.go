package service

import (
	"fmt"
	"log"
	"sort"
	"strings"
)

// 描述：输出 agent_3d 服务审计日志，统一包含事件名与关键上下文字段。
func logAgent3DAuditEvent(event string, fields map[string]string) {
	parts := make([]string, 0, len(fields))
	for key, value := range fields {
		parts = append(parts, fmt.Sprintf("%s=%s", key, value))
	}
	sort.Strings(parts)
	log.Printf("[audit][agent_3d] event=%s %s", event, strings.Join(parts, " "))
}
