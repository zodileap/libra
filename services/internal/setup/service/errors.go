package service

import (
	"errors"
	"fmt"
	"net/http"
)

const (
	// 描述：参数非法时返回的业务状态码。
	codeInvalidParam = 100002002
	// 描述：资源冲突或初始化状态冲突时返回的业务状态码。
	codeConflict = 100004001
	// 描述：资源不存在时返回的业务状态码。
	codeNotFound = 100005001
	// 描述：方法不允许时返回的业务状态码。
	codeMethodNotAllowed = 100006001
	// 描述：请求体解析失败时返回的业务状态码。
	codeDecode = 100007001
	// 描述：依赖服务不可用时返回的业务状态码。
	codeDependency = 100009001
	// 描述：服务内部异常时返回的业务状态码。
	codeInternal = 500001
)

// 描述：统一封装 setup 服务错误，承载 HTTP 状态码、业务状态码和用户可见文案。
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

// 描述：暴露底层错误原因，便于使用 `errors.Is` 和 `errors.As`。
func (e *ServiceError) Unwrap() error {
	if e == nil {
		return nil
	}
	return e.Cause
}

// 描述：创建统一错误对象，并保证业务状态码和 HTTP 状态码成对出现。
func newServiceError(code int, httpStatus int, message string, cause error) *ServiceError {
	return &ServiceError{Code: code, HTTPStatus: httpStatus, Message: message, Cause: cause}
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

// 描述：创建通用参数错误，用于请求字段校验失败场景。
func NewInvalidParamError(message string) error {
	return newServiceError(codeInvalidParam, http.StatusBadRequest, message, nil)
}

// 描述：创建冲突错误，用于重复初始化、重复完成安装和步骤顺序错误场景。
func NewConflictError(message string) error {
	return newServiceError(codeConflict, http.StatusConflict, message, nil)
}

// 描述：创建资源不存在错误，用于缺少配置或依赖资源场景。
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

// 描述：创建依赖服务错误，用于 account 服务不可访问或返回异常的场景。
func NewDependencyError(message string, cause error) error {
	return newServiceError(codeDependency, http.StatusBadGateway, message, cause)
}

// 描述：创建内部错误，保留底层原因并返回统一对外文案。
func newInternalError(message string, cause error) *ServiceError {
	return newServiceError(codeInternal, http.StatusInternalServerError, message, cause)
}
