package schema

import (
	zspecs "git.zodileap.com/taurus/zodileap_go_zspecs"
	"github.com/zodileap/taurus_go/entity"
)

type AgentSessionEntity struct {
	entity.Entity
	Id        *zspecs.IdE        `json:"id"`
	UserId    *zspecs.UserIdE    `json:"user_id"`
	AgentCode *zspecs.CodeE      `json:"agent_code"`
	Status    *zspecs.StatusE    `json:"status"`
	CreatedAt *zspecs.CreatedAtE `json:"created_at"`
	LastAt    *zspecs.LastAtE    `json:"last_at"`
	DeletedAt *zspecs.DeletedAtE `json:"deleted_at,omitempty"`
}

func (e *AgentSessionEntity) Config() entity.EntityConfig {
	return entity.EntityConfig{AttrName: "agent_session", Comment: "智能体会话"}
}

func (e *AgentSessionEntity) Fields() []entity.FieldBuilder {
	return []entity.FieldBuilder{
		e.Id.Name("id").Primary(1).Sequence(entity.NewSequence("agent_session_id_seq")).Comment("主键Id"),
		e.UserId.Name("user_id").Required().Comment("用户Id"),
		e.AgentCode.Name("agent_code").MaxLen(128).Required().Comment("智能体编码"),
		e.Status.Name("status").Default(1).Comment("状态"),
		e.CreatedAt.Name("created_at").Default("CURRENT_TIMESTAMP").Precision(6).Comment("创建数据时间"),
		e.LastAt.Name("last_at").Default("CURRENT_TIMESTAMP").Precision(6).Comment("更新数据时间"),
		e.DeletedAt.Name("deleted_at").Default("NULL").Precision(6).Comment("删除数据时间（逻辑删除）"),
	}
}
