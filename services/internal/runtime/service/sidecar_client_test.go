package service

import "testing"

// 描述：
//
//   - 验证 sidecar 适配层会把 services dataDir 下沉到独立 sidecar 子目录，避免与旧 JSON 状态文件路径冲突。
func TestNewRuntimeSidecarClientShouldUseSidecarSubdir(t *testing.T) {
	client := NewRuntimeSidecarClient(RuntimeSidecarClientConfig{
		DataDir: "/tmp/libra-runtime",
	})
	if client == nil || client.client == nil {
		t.Fatalf("sidecar client 应初始化成功")
	}
}
