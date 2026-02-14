package server

// 描述：RPC 模块最小注册接口，后续由 toolkit 注入具体实现。
type Registry interface {
	Register(name string, handler any)
}

// 描述：注册当前服务 RPC 能力，当前阶段保留最小可用空实现，确保模块可编译可扩展。
func RegisterRPC(_ Registry) {}

// 描述：加载 RPC 模块占位注册入口。
func init() {}
