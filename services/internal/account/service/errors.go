package service

import (
	"errors"
	"fmt"
	"net/http"
)

const (
	// 描述：未授权或令牌失效时返回的业务状态码。
	codeUnauthorized = 100001001
	// 描述：邮箱格式非法时返回的业务状态码。
	codeInvalidEmail = 100002001
	// 描述：密码或请求参数非法时返回的业务状态码。
	codeInvalidParam = 100002002
	// 描述：登录凭证错误时返回的业务状态码。
	codeInvalidCredential = 1008001004
	// 描述：无权限执行管理操作时返回的业务状态码。
	codeForbidden = 100003001
	// 描述：资源冲突或初始化状态冲突时返回的业务状态码。
	codeConflict = 100004001
	// 描述：资源不存在时返回的业务状态码。
	codeNotFound = 100005001
	// 描述：方法不允许时返回的业务状态码。
	codeMethodNotAllowed = 100006001
	// 描述：请求体解析失败时返回的业务状态码。
	codeDecode = 100007001
	// 描述：服务内部异常时返回的业务状态码。
	codeInternal = 500001
)

// 描述：统一封装账号服务错误，承载 HTTP 状态码、业务状态码和用户可见文案。
type ServiceError struct {
	Code       int
	HTTPStatus int
	Message    string
	Cause      error
}

// 描述：实现 error 接口，返回对外错误文案。
func (e *ServiceError) Error() string {
	if e == nil {
		return ""
	}
	return e.Message
}

// 描述：为错误链暴露底层原因，便于使用 `errors.Is` 与 `errors.As`。
func (e *ServiceError) Unwrap() error {
	if e == nil {
		return nil
	}
	return e.Cause
}

// 描述：创建统一错误对象，并保证业务状态码和 HTTP 状态码成对出现。
func newServiceError(code int, httpStatus int, message string, cause error) *ServiceError {
	return &ServiceError{
		Code:       code,
		HTTPStatus: httpStatus,
		Message:    message,
		Cause:      cause,
	}
}

// 描述：将任意错误映射为 `ServiceError`，未知错误统一转为内部错误。
func AsServiceError(err error) *ServiceError {
	if err == nil {
		return nil
	}
	var serviceErr *ServiceError
	if errors.As(err, &serviceErr) {
		return serviceErr
	}
	return newInternalError("服务暂时不可用，请稍后重试。", err)
}

// 描述：创建未授权错误，用于 token 缺失、无效或过期场景。
func NewUnauthorizedError(message string) error {
	return newServiceError(codeUnauthorized, http.StatusUnauthorized, message, nil)
}

// 描述：创建邮箱格式错误，用于登录和管理员初始化校验。
func NewInvalidEmailError(message string) error {
	return newServiceError(codeInvalidEmail, http.StatusBadRequest, message, nil)
}

// 描述：创建通用参数错误，用于密码、名称和其他请求字段校验。
func NewInvalidParamError(message string) error {
	return newServiceError(codeInvalidParam, http.StatusBadRequest, message, nil)
}

// 描述：创建登录凭证错误，用于邮箱存在但密码不匹配等场景。
func NewInvalidCredentialError() error {
	return newServiceError(codeInvalidCredential, http.StatusUnauthorized, "账号或密码错误，请检查后重试。", nil)
}

// 描述：创建权限不足错误，用于非管理员执行授权管理或 bootstrap 令牌不匹配场景。
func NewForbiddenError(message string) error {
	return newServiceError(codeForbidden, http.StatusForbidden, message, nil)
}

// 描述：创建冲突错误，用于重复初始化、重复创建和状态冲突场景。
func NewConflictError(message string) error {
	return newServiceError(codeConflict, http.StatusConflict, message, nil)
}

// 描述：创建资源不存在错误，用于用户、授权记录等资源查询失败场景。
func NewNotFoundError(message string) error {
	return newServiceError(codeNotFound, http.StatusNotFound, message, nil)
}

// 描述：创建方法不允许错误，限制路由允许的 HTTP 动作。
func NewMethodNotAllowedError(method string) error {
	return newServiceError(codeMethodNotAllowed, http.StatusMethodNotAllowed, fmt.Sprintf("不支持的请求方法: %s", method), nil)
}

// 描述：创建 JSON 解码错误，统一向前端返回参数解析失败提示。
func NewDecodeError(err error) error {
	return newServiceError(codeDecode, http.StatusBadRequest, "请求数据不合法，请检查输入后重试。", err)
}

// 描述：创建内部错误，保留底层原因并返回统一对外文案。
func newInternalError(message string, cause error) *ServiceError {
	return newServiceError(codeInternal, http.StatusInternalServerError, message, cause)
}
