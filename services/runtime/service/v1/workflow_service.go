package service

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"os"
	"sort"
	"strconv"
	"strings"
	"time"

	specs "github.com/zodileap/libra/services/runtime/specs/v1"
)

const (
	// 描述：会话消息默认页码。
	defaultMessagePage = 1
	// 描述：会话消息默认分页大小。
	defaultMessagePageSize = 20
	// 描述：会话消息最大分页大小。
	maxMessagePageSize = 200
	// 描述：桌面端更新检查默认通道。
	defaultDesktopUpdateChannel = "stable"
	// 描述：默认激活状态，保持与 Desktop 当前会话筛选逻辑兼容。
	defaultActiveStatus = 1
)

// 描述：Runtime 业务工作流服务，聚合会话、消息、Sandbox、Preview 与桌面更新检查能力。
type WorkflowService struct {
	store *stateStore
}

// 描述：创建 Runtime 业务工作流服务实例，并初始化本地状态存储。
func NewWorkflowService(dataDir string) (*WorkflowService, error) {
	store, err := newStateStore(dataDir)
	if err != nil {
		return nil, err
	}
	return &WorkflowService{store: store}, nil
}

// 描述：创建会话，并为 Desktop 返回立即可用的基础会话实体。
func (s *WorkflowService) CreateSession(req specs.WorkflowSessionCreateReq) (specs.WorkflowSessionCreateResp, error) {
	userID := strings.TrimSpace(req.UserId)
	agentCode := strings.TrimSpace(req.AgentCode)
	if userID == "" {
		return specs.WorkflowSessionCreateResp{}, newValidationError("userId 不能为空")
	}
	if agentCode == "" {
		return specs.WorkflowSessionCreateResp{}, newValidationError("agentCode 不能为空")
	}

	return withWrite(s.store, func(state *runtimeState) (specs.WorkflowSessionCreateResp, error) {
		now := nowRFC3339()
		session := specs.RuntimeSessionEntity{
			ID:        newID(),
			UserID:    userID,
			AgentCode: agentCode,
			Status:    defaultStatus(req.Status),
			CreatedAt: now,
			LastAt:    now,
		}
		state.Sessions[session.ID] = session
		logRuntimeAuditEvent("workflow.session.created", map[string]string{
			"userId":    userID,
			"sessionId": session.ID,
			"agentCode": agentCode,
		})
		return specs.WorkflowSessionCreateResp{Session: session}, nil
	})
}

// 描述：查询会话列表，按最近更新时间倒序返回，支持用户、智能体和状态筛选。
func (s *WorkflowService) ListSession(req specs.WorkflowSessionListReq) (specs.WorkflowSessionListResp, error) {
	userID := strings.TrimSpace(req.UserId)
	if userID == "" {
		return specs.WorkflowSessionListResp{}, newValidationError("userId 不能为空")
	}

	return withRead(s.store, func(state *runtimeState) (specs.WorkflowSessionListResp, error) {
		list := make([]specs.RuntimeSessionEntity, 0)
		for _, item := range state.Sessions {
			if item.DeletedAt != "" {
				continue
			}
			if item.UserID != userID {
				continue
			}
			if req.AgentCode != nil && strings.TrimSpace(*req.AgentCode) != "" && item.AgentCode != strings.TrimSpace(*req.AgentCode) {
				continue
			}
			if req.Status != nil && item.Status != *req.Status {
				continue
			}
			list = append(list, item)
		}

		sort.Slice(list, func(i int, j int) bool {
			return list[i].LastAt > list[j].LastAt
		})
		if req.ByLastAt != nil && *req.ByLastAt < 0 {
			slicesReverseSession(list)
		}
		return specs.WorkflowSessionListResp{List: list}, nil
	})
}

// 描述：查询会话详情，并校验会话归属关系。
func (s *WorkflowService) GetSession(req specs.WorkflowSessionGetReq) (specs.WorkflowSessionGetResp, error) {
	userID := strings.TrimSpace(req.UserId)
	sessionID := strings.TrimSpace(req.SessionId)
	if userID == "" || sessionID == "" {
		return specs.WorkflowSessionGetResp{}, newValidationError("sessionId 和 userId 不能为空")
	}

	return withRead(s.store, func(state *runtimeState) (specs.WorkflowSessionGetResp, error) {
		session, err := mustSessionOwnerLocked(state, sessionID, userID)
		if err != nil {
			return specs.WorkflowSessionGetResp{}, err
		}
		return specs.WorkflowSessionGetResp{Session: session}, nil
	})
}

// 描述：更新会话状态，并刷新最后更新时间。
func (s *WorkflowService) UpdateSessionStatus(req specs.WorkflowSessionStatusUpdateReq) (specs.WorkflowSessionStatusUpdateResp, error) {
	userID := strings.TrimSpace(req.UserId)
	sessionID := strings.TrimSpace(req.SessionId)
	if userID == "" || sessionID == "" {
		return specs.WorkflowSessionStatusUpdateResp{}, newValidationError("sessionId 和 userId 不能为空")
	}

	return withWrite(s.store, func(state *runtimeState) (specs.WorkflowSessionStatusUpdateResp, error) {
		session, err := mustSessionOwnerLocked(state, sessionID, userID)
		if err != nil {
			return specs.WorkflowSessionStatusUpdateResp{}, err
		}
		session.Status = req.Status
		session.LastAt = nowRFC3339()
		state.Sessions[session.ID] = session
		logRuntimeAuditEvent("workflow.session.status.updated", map[string]string{
			"userId":    userID,
			"sessionId": session.ID,
			"status":    strconv.Itoa(req.Status),
		})
		return specs.WorkflowSessionStatusUpdateResp{Session: session}, nil
	})
}

// 描述：写入会话消息，并同步刷新会话的最后更新时间。
func (s *WorkflowService) CreateSessionMessage(req specs.WorkflowSessionMessageCreateReq) (specs.WorkflowSessionMessageCreateResp, error) {
	userID := strings.TrimSpace(req.UserId)
	sessionID := strings.TrimSpace(req.SessionId)
	role := strings.TrimSpace(req.Role)
	content := strings.TrimSpace(req.Content)
	if userID == "" || sessionID == "" {
		return specs.WorkflowSessionMessageCreateResp{}, newValidationError("sessionId 和 userId 不能为空")
	}
	if role == "" {
		return specs.WorkflowSessionMessageCreateResp{}, newValidationError("role 不能为空")
	}
	if content == "" {
		return specs.WorkflowSessionMessageCreateResp{}, newValidationError("content 不能为空")
	}

	return withWrite(s.store, func(state *runtimeState) (specs.WorkflowSessionMessageCreateResp, error) {
		session, err := mustSessionOwnerLocked(state, sessionID, userID)
		if err != nil {
			return specs.WorkflowSessionMessageCreateResp{}, err
		}

		state.MessageSeq++
		message := specs.WorkflowSessionMessageItem{
			MessageId: strconv.FormatInt(state.MessageSeq, 10),
			SessionId: sessionID,
			UserId:    userID,
			Role:      role,
			Content:   content,
			CreatedAt: nowRFC3339(),
		}
		state.Messages[sessionID] = append(state.Messages[sessionID], message)
		session.LastAt = message.CreatedAt
		state.Sessions[session.ID] = session
		return specs.WorkflowSessionMessageCreateResp{Message: message}, nil
	})
}

// 描述：分页查询会话消息，并确保不同用户无法跨会话读取消息。
func (s *WorkflowService) ListSessionMessage(req specs.WorkflowSessionMessageListReq) (specs.WorkflowSessionMessageListResp, error) {
	userID := strings.TrimSpace(req.UserId)
	sessionID := strings.TrimSpace(req.SessionId)
	if userID == "" || sessionID == "" {
		return specs.WorkflowSessionMessageListResp{}, newValidationError("sessionId 和 userId 不能为空")
	}
	page, pageSize := normalizePagination(req.Page, req.PageSize)

	return withRead(s.store, func(state *runtimeState) (specs.WorkflowSessionMessageListResp, error) {
		if _, err := mustSessionOwnerLocked(state, sessionID, userID); err != nil {
			return specs.WorkflowSessionMessageListResp{}, err
		}

		messages := append([]specs.WorkflowSessionMessageItem(nil), state.Messages[sessionID]...)
		total := len(messages)
		start := (page - 1) * pageSize
		if start >= total {
			return specs.WorkflowSessionMessageListResp{List: []specs.WorkflowSessionMessageItem{}, Total: total, Page: page, PageSize: pageSize}, nil
		}
		end := start + pageSize
		if end > total {
			end = total
		}
		return specs.WorkflowSessionMessageListResp{
			List:     messages[start:end],
			Total:    total,
			Page:     page,
			PageSize: pageSize,
		}, nil
	})
}

// 描述：创建 Sandbox 实例，并要求会话归属当前用户。
func (s *WorkflowService) CreateSandbox(req specs.WorkflowSandboxCreateReq) (specs.WorkflowSandboxCreateResp, error) {
	userID := strings.TrimSpace(req.UserId)
	sessionID := strings.TrimSpace(req.SessionId)
	if userID == "" || sessionID == "" {
		return specs.WorkflowSandboxCreateResp{}, newValidationError("sessionId 和 userId 不能为空")
	}

	return withWrite(s.store, func(state *runtimeState) (specs.WorkflowSandboxCreateResp, error) {
		if _, err := mustSessionOwnerLocked(state, sessionID, userID); err != nil {
			return specs.WorkflowSandboxCreateResp{}, err
		}
		now := nowRFC3339()
		sandbox := specs.RuntimeSandboxEntity{
			ID:          newID(),
			SessionID:   sessionID,
			ContainerID: trimOptionalString(req.ContainerId),
			PreviewURL:  trimOptionalString(req.PreviewUrl),
			Status:      defaultStatus(req.Status),
			CreatedAt:   now,
			LastAt:      now,
		}
		state.Sandboxes[sandbox.ID] = sandbox
		return specs.WorkflowSandboxCreateResp{Sandbox: sandbox}, nil
	})
}

// 描述：查询 Sandbox 列表，并对结果执行当前用户的会话归属过滤。
func (s *WorkflowService) GetSandbox(req specs.WorkflowSandboxGetReq) (specs.WorkflowSandboxGetResp, error) {
	userID := strings.TrimSpace(req.UserId)
	if userID == "" {
		return specs.WorkflowSandboxGetResp{}, newValidationError("userId 不能为空")
	}
	if req.SandboxId == nil && req.SessionId == nil {
		return specs.WorkflowSandboxGetResp{}, newValidationError("sandboxId 或 sessionId 至少一个必填")
	}

	return withRead(s.store, func(state *runtimeState) (specs.WorkflowSandboxGetResp, error) {
		list := make([]specs.RuntimeSandboxEntity, 0)
		for _, sandbox := range state.Sandboxes {
			if sandbox.DeletedAt != "" {
				continue
			}
			if req.SandboxId != nil && strings.TrimSpace(*req.SandboxId) != "" && sandbox.ID != strings.TrimSpace(*req.SandboxId) {
				continue
			}
			if req.SessionId != nil && strings.TrimSpace(*req.SessionId) != "" && sandbox.SessionID != strings.TrimSpace(*req.SessionId) {
				continue
			}
			if _, err := mustSessionOwnerLocked(state, sandbox.SessionID, userID); err != nil {
				continue
			}
			list = append(list, sandbox)
		}
		return specs.WorkflowSandboxGetResp{List: list}, nil
	})
}

// 描述：回收 Sandbox，并同步移除其关联的预览地址记录。
func (s *WorkflowService) RecycleSandbox(req specs.WorkflowSandboxRecycleReq) (specs.WorkflowSandboxRecycleResp, error) {
	userID := strings.TrimSpace(req.UserId)
	if userID == "" {
		return specs.WorkflowSandboxRecycleResp{}, newValidationError("userId 不能为空")
	}
	if req.SandboxId == nil && req.SessionId == nil {
		return specs.WorkflowSandboxRecycleResp{}, newValidationError("sandboxId 或 sessionId 至少一个必填")
	}

	return withWrite(s.store, func(state *runtimeState) (specs.WorkflowSandboxRecycleResp, error) {
		removed := false
		for id, sandbox := range state.Sandboxes {
			if sandbox.DeletedAt != "" {
				continue
			}
			if req.SandboxId != nil && strings.TrimSpace(*req.SandboxId) != "" && sandbox.ID != strings.TrimSpace(*req.SandboxId) {
				continue
			}
			if req.SessionId != nil && strings.TrimSpace(*req.SessionId) != "" && sandbox.SessionID != strings.TrimSpace(*req.SessionId) {
				continue
			}
			if _, err := mustSessionOwnerLocked(state, sandbox.SessionID, userID); err != nil {
				continue
			}
			delete(state.Sandboxes, id)
			for previewID, preview := range state.Previews {
				if preview.SandboxID == id {
					delete(state.Previews, previewID)
				}
			}
			removed = true
		}
		if !removed {
			return specs.WorkflowSandboxRecycleResp{}, newNotFoundError("未找到可回收的 sandbox")
		}
		return specs.WorkflowSandboxRecycleResp{Success: true}, nil
	})
}

// 描述：创建预览地址，并要求目标 Sandbox 必须归属于当前用户。
func (s *WorkflowService) CreatePreview(req specs.WorkflowPreviewCreateReq) (specs.WorkflowPreviewCreateResp, error) {
	userID := strings.TrimSpace(req.UserId)
	sandboxID := strings.TrimSpace(req.SandboxId)
	url := strings.TrimSpace(req.Url)
	if userID == "" || sandboxID == "" {
		return specs.WorkflowPreviewCreateResp{}, newValidationError("sandboxId 和 userId 不能为空")
	}
	if url == "" {
		return specs.WorkflowPreviewCreateResp{}, newValidationError("url 不能为空")
	}

	return withWrite(s.store, func(state *runtimeState) (specs.WorkflowPreviewCreateResp, error) {
		if _, err := mustSandboxOwnerLocked(state, sandboxID, userID); err != nil {
			return specs.WorkflowPreviewCreateResp{}, err
		}
		now := nowRFC3339()
		preview := specs.RuntimePreviewEntity{
			ID:        newID(),
			SandboxID: sandboxID,
			URL:       url,
			Status:    defaultStatus(req.Status),
			ExpiresAt: resolvePreviewExpireAt(req.Expiration),
			CreatedAt: now,
			LastAt:    now,
		}
		state.Previews[preview.ID] = preview
		return specs.WorkflowPreviewCreateResp{Preview: preview}, nil
	})
}

// 描述：查询预览地址列表，并根据 Sandbox 归属过滤数据。
func (s *WorkflowService) GetPreview(req specs.WorkflowPreviewGetReq) (specs.WorkflowPreviewGetResp, error) {
	userID := strings.TrimSpace(req.UserId)
	if userID == "" {
		return specs.WorkflowPreviewGetResp{}, newValidationError("userId 不能为空")
	}
	if req.PreviewId == nil && req.SandboxId == nil {
		return specs.WorkflowPreviewGetResp{}, newValidationError("previewId 或 sandboxId 至少一个必填")
	}

	return withRead(s.store, func(state *runtimeState) (specs.WorkflowPreviewGetResp, error) {
		list := make([]specs.RuntimePreviewEntity, 0)
		for _, preview := range state.Previews {
			if preview.DeletedAt != "" {
				continue
			}
			if req.PreviewId != nil && strings.TrimSpace(*req.PreviewId) != "" && preview.ID != strings.TrimSpace(*req.PreviewId) {
				continue
			}
			if req.SandboxId != nil && strings.TrimSpace(*req.SandboxId) != "" && preview.SandboxID != strings.TrimSpace(*req.SandboxId) {
				continue
			}
			if _, err := mustSandboxOwnerLocked(state, preview.SandboxID, userID); err != nil {
				continue
			}
			list = append(list, preview)
		}
		return specs.WorkflowPreviewGetResp{List: list}, nil
	})
}

// 描述：让预览地址失效，支持按预览 ID 或 Sandbox ID 批量移除。
func (s *WorkflowService) ExpirePreview(req specs.WorkflowPreviewExpireReq) (specs.WorkflowPreviewExpireResp, error) {
	userID := strings.TrimSpace(req.UserId)
	if userID == "" {
		return specs.WorkflowPreviewExpireResp{}, newValidationError("userId 不能为空")
	}
	if req.PreviewId == nil && req.SandboxId == nil {
		return specs.WorkflowPreviewExpireResp{}, newValidationError("previewId 或 sandboxId 至少一个必填")
	}

	return withWrite(s.store, func(state *runtimeState) (specs.WorkflowPreviewExpireResp, error) {
		removed := false
		for id, preview := range state.Previews {
			if preview.DeletedAt != "" {
				continue
			}
			if req.PreviewId != nil && strings.TrimSpace(*req.PreviewId) != "" && preview.ID != strings.TrimSpace(*req.PreviewId) {
				continue
			}
			if req.SandboxId != nil && strings.TrimSpace(*req.SandboxId) != "" && preview.SandboxID != strings.TrimSpace(*req.SandboxId) {
				continue
			}
			if _, err := mustSandboxOwnerLocked(state, preview.SandboxID, userID); err != nil {
				continue
			}
			delete(state.Previews, id)
			removed = true
		}
		if !removed {
			return specs.WorkflowPreviewExpireResp{}, newNotFoundError("未找到可失效的预览地址")
		}
		return specs.WorkflowPreviewExpireResp{Success: true}, nil
	})
}

// 描述：检查桌面端是否存在可更新版本，并返回对应平台下载地址。
func (s *WorkflowService) CheckDesktopUpdate(req specs.WorkflowDesktopUpdateCheckReq) (specs.WorkflowDesktopUpdateCheckResp, error) {
	channel := resolveDesktopUpdateChannel(req.Channel)
	currentVersion := strings.TrimSpace(req.CurrentVersion)
	latestVersion := strings.TrimSpace(envValue("LIBRA_DESKTOP_LATEST_VERSION"))
	downloadURL := resolveDesktopUpdateDownloadURL(req.Platform, req.Arch, channel)
	checksumSHA256 := strings.TrimSpace(envValue("LIBRA_DESKTOP_CHECKSUM_SHA256"))
	releaseNotes := strings.TrimSpace(envValue("LIBRA_DESKTOP_RELEASE_NOTES"))
	publishedAt := resolveDesktopUpdatePublishedAt()

	resp := specs.WorkflowDesktopUpdateCheckResp{
		Channel:        channel,
		LatestVersion:  latestVersion,
		DownloadURL:    downloadURL,
		ChecksumSHA256: checksumSHA256,
		ReleaseNotes:   releaseNotes,
		PublishedAt:    publishedAt,
	}
	if latestVersion == "" || downloadURL == "" {
		return resp, nil
	}
	resp.HasUpdate = compareSemverVersion(currentVersion, latestVersion) < 0
	return resp, nil
}

// 描述：归一化分页参数。
func normalizePagination(page int, pageSize int) (int, int) {
	if page <= 0 {
		page = defaultMessagePage
	}
	if pageSize <= 0 {
		pageSize = defaultMessagePageSize
	}
	if pageSize > maxMessagePageSize {
		pageSize = maxMessagePageSize
	}
	return page, pageSize
}

// 描述：归一化桌面更新通道，未传时回退到 stable。
func resolveDesktopUpdateChannel(raw string) string {
	channel := strings.ToLower(strings.TrimSpace(raw))
	if channel == "" {
		return defaultDesktopUpdateChannel
	}
	return channel
}

// 描述：解析桌面端更新发布时间，未配置时回退到当前时间，保证前端展示字段始终有值。
func resolveDesktopUpdatePublishedAt() string {
	raw := strings.TrimSpace(envValue("LIBRA_DESKTOP_PUBLISHED_AT"))
	if raw != "" {
		return raw
	}
	return nowRFC3339()
}

// 描述：根据平台、架构与通道解析桌面端下载地址，优先命中最具体环境变量。
func resolveDesktopUpdateDownloadURL(platform string, arch string, channel string) string {
	platformKey := strings.ToUpper(strings.ReplaceAll(strings.TrimSpace(platform), "-", "_"))
	archKey := strings.ToUpper(strings.ReplaceAll(strings.TrimSpace(arch), "-", "_"))
	channelKey := strings.ToUpper(strings.ReplaceAll(strings.TrimSpace(channel), "-", "_"))

	keys := []string{
		"DESKTOP_DOWNLOAD_URL",
		"DESKTOP_DOWNLOAD_URL_" + platformKey,
		"DESKTOP_DOWNLOAD_URL_" + platformKey + "_" + archKey,
	}
	if channelKey != "" {
		keys = append(keys,
			"DESKTOP_DOWNLOAD_URL_"+channelKey,
			"DESKTOP_DOWNLOAD_URL_"+platformKey+"_"+channelKey,
			"DESKTOP_DOWNLOAD_URL_"+platformKey+"_"+archKey+"_"+channelKey,
		)
	}

	prefixes := []string{"LIBRA"}
	candidates := make([]string, 0, len(prefixes)*len(keys))
	for _, prefix := range prefixes {
		for _, key := range keys {
			candidates = append(candidates, prefix+"_"+key)
		}
	}
	for index := len(candidates) - 1; index >= 0; index-- {
		value := strings.TrimSpace(os.Getenv(candidates[index]))
		if value != "" {
			return value
		}
	}
	return ""
}

// 描述：比较语义化版本号，返回 -1/0/1。
func compareSemverVersion(current string, target string) int {
	currentParts := parseSemverParts(current)
	targetParts := parseSemverParts(target)
	if len(currentParts) == 0 || len(targetParts) == 0 {
		return 0
	}
	limit := len(currentParts)
	if len(targetParts) > limit {
		limit = len(targetParts)
	}
	for len(currentParts) < limit {
		currentParts = append(currentParts, 0)
	}
	for len(targetParts) < limit {
		targetParts = append(targetParts, 0)
	}
	for index := 0; index < limit; index++ {
		if currentParts[index] < targetParts[index] {
			return -1
		}
		if currentParts[index] > targetParts[index] {
			return 1
		}
	}
	return 0
}

// 描述：解析语义化版本号为整数切片，忽略前缀 `v` 和后缀标签。
func parseSemverParts(raw string) []int {
	normalized := strings.ToLower(strings.TrimSpace(raw))
	normalized = strings.TrimPrefix(normalized, "v")
	if normalized == "" {
		return nil
	}
	if dashIndex := strings.Index(normalized, "-"); dashIndex >= 0 {
		normalized = normalized[:dashIndex]
	}
	segments := strings.Split(normalized, ".")
	parts := make([]int, 0, len(segments))
	for _, segment := range segments {
		text := strings.TrimSpace(segment)
		if text == "" {
			return nil
		}
		value, err := strconv.Atoi(text)
		if err != nil {
			return nil
		}
		parts = append(parts, value)
	}
	return parts
}

// 描述：校验会话是否归属当前用户。
func mustSessionOwnerLocked(state *runtimeState, sessionID string, userID string) (specs.RuntimeSessionEntity, error) {
	session, ok := state.Sessions[sessionID]
	if !ok || session.DeletedAt != "" {
		return specs.RuntimeSessionEntity{}, newNotFoundError("会话不存在")
	}
	if session.UserID != userID {
		return specs.RuntimeSessionEntity{}, newForbiddenError("会话不属于当前用户")
	}
	return session, nil
}

// 描述：校验 Sandbox 是否归属当前用户。
func mustSandboxOwnerLocked(state *runtimeState, sandboxID string, userID string) (specs.RuntimeSandboxEntity, error) {
	sandbox, ok := state.Sandboxes[sandboxID]
	if !ok || sandbox.DeletedAt != "" {
		return specs.RuntimeSandboxEntity{}, newNotFoundError("Sandbox 不存在")
	}
	if _, err := mustSessionOwnerLocked(state, sandbox.SessionID, userID); err != nil {
		return specs.RuntimeSandboxEntity{}, err
	}
	return sandbox, nil
}

// 描述：生成开源版 runtime 所需的随机字符串 ID，避免依赖外部 ID 包。
func newID() string {
	payload := make([]byte, 16)
	if _, err := rand.Read(payload); err != nil {
		return fmt.Sprintf("libra-%d", time.Now().UnixNano())
	}
	return hex.EncodeToString(payload)
}

// 描述：返回当前 UTC 时间的 RFC3339 字符串，保证前后端时间格式统一。
func nowRFC3339() string {
	return time.Now().UTC().Format(time.RFC3339)
}

// 描述：读取多个环境变量中的第一个非空值，便于对同一配置提供多级候选键。
func envValue(keys ...string) string {
	for _, key := range keys {
		value := strings.TrimSpace(os.Getenv(key))
		if value != "" {
			return value
		}
	}
	return ""
}

// 描述：为状态字段提供默认值，未显式传入时回退到激活状态。
func defaultStatus(raw *int) int {
	if raw == nil {
		return defaultActiveStatus
	}
	return *raw
}

// 描述：归一化可选字符串字段，避免将空白字符串持久化到状态文件。
func trimOptionalString(raw *string) string {
	if raw == nil {
		return ""
	}
	return strings.TrimSpace(*raw)
}

// 描述：计算预览过期时间，未提供时返回空字符串表示长期有效。
func resolvePreviewExpireAt(expiration *int64) string {
	if expiration == nil || *expiration <= 0 {
		return ""
	}
	return time.Now().UTC().Add(time.Duration(*expiration) * time.Second).Format(time.RFC3339)
}

// 描述：原地反转会话切片，用于支持按更新时间升序查看。
func slicesReverseSession(list []specs.RuntimeSessionEntity) {
	for left, right := 0, len(list)-1; left < right; left, right = left+1, right-1 {
		list[left], list[right] = list[right], list[left]
	}
}
