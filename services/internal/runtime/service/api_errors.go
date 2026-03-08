package service

import "fmt"

var apiErrorFactory = struct{}{}

// 描述：暴露 API 层需要复用的错误构造入口，当前用于保持 handler 代码简洁。
func ExposeAPIErrors() {}

// 描述：构造 JSON 解析失败错误。
func NewDecodeError(err error) error {
	return newValidationError(fmt.Sprintf("请求体格式无效: %v", err))
}

// 描述：构造非法查询参数错误。
func NewInvalidQueryError(key string) error {
	return newValidationError(fmt.Sprintf("查询参数 %s 无效", key))
}

// 描述：构造方法不允许错误。
func NewMethodNotAllowedError(method string) error {
	return &ServiceError{HTTPStatus: 405, Code: badRequestCode, Message: fmt.Sprintf("不支持的请求方法: %s", method)}
}
