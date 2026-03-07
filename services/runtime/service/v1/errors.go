package service

import "fmt"

const (
	// 描述：统一成功业务码。
	successCode = 200
	// 描述：统一参数错误业务码。
	badRequestCode = 400001
	// 描述：统一无权限访问业务码。
	forbiddenCode = 403001
	// 描述：统一资源不存在业务码。
	notFoundCode = 404001
	// 描述：统一服务内部错误业务码。
	internalErrorCode = 500001
)

// 描述：服务错误对象，统一承载 HTTP 状态、业务码与对外可展示信息。
type ServiceError struct {
	HTTPStatus int
	Code       int
	Message    string
	Cause      error
}

// 描述：输出错误文本，便于日志或测试中直接定位失败原因。
func (e *ServiceError) Error() string {
	if e == nil {
		return ""
	}
	if e.Cause == nil {
		return e.Message
	}
	return fmt.Sprintf("%s: %v", e.Message, e.Cause)
}

// 描述：构造参数校验错误。
func newValidationError(message string) error {
	return &ServiceError{HTTPStatus: 400, Code: badRequestCode, Message: message}
}

// 描述：构造权限校验错误。
func newForbiddenError(message string) error {
	return &ServiceError{HTTPStatus: 403, Code: forbiddenCode, Message: message}
}

// 描述：构造资源不存在错误。
func newNotFoundError(message string) error {
	return &ServiceError{HTTPStatus: 404, Code: notFoundCode, Message: message}
}

// 描述：构造内部存储错误。
func newInternalError(message string, cause error) error {
	return &ServiceError{HTTPStatus: 500, Code: internalErrorCode, Message: message, Cause: cause}
}
