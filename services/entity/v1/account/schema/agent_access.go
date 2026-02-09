package schema

import (
	zspecs "git.zodileap.com/taurus/zodileap_go_zspecs"
	"github.com/zodileap/taurus_go/entity"
)

type AgentAccessEntity struct {
	entity.Entity
	Id         *zspecs.IdE        `json:"id"`
	UserId     *zspecs.UserIdE    `json:"user_id"`
	AgentId    *zspecs.IdE        `json:"agent_id"`
	AccessType *zspecs.StatusE    `json:"access_type"`
	Duration   *zspecs.DurationE  `json:"duration"`
	Status     *zspecs.StatusE    `json:"status"`
	CreatedAt  *zspecs.CreatedAtE `json:"created_at"`
	LastAt     *zspecs.LastAtE    `json:"last_at"`
	DeletedAt  *zspecs.DeletedAtE `json:"deleted_at,omitempty"`
}

func (e *AgentAccessEntity) Config() entity.EntityConfig {
	return entity.EntityConfig{AttrName: "agent_access", Comment: "用户智能体授权"}
}

func (e *AgentAccessEntity) Fields() []entity.FieldBuilder {
	return []entity.FieldBuilder{
		e.Id.Name("id").Primary(1).Sequence(entity.NewSequence("agent_access_id_seq")).Comment("主键Id"),
		e.UserId.Name("user_id").Required().Comment("用户Id"),
		e.AgentId.Name("agent_id").Required().Comment("智能体Id"),
		e.AccessType.Name("access_type").Default(1).Comment("授权类型"),
		e.Duration.Name("duration").Default(0).Comment("有效时长"),
		e.Status.Name("status").Default(1).Comment("状态"),
		e.CreatedAt.Name("created_at").Default("CURRENT_TIMESTAMP").Precision(6).Comment("创建数据时间"),
		e.LastAt.Name("last_at").Default("CURRENT_TIMESTAMP").Precision(6).Comment("更新数据时间"),
		e.DeletedAt.Name("deleted_at").Default("NULL").Precision(6).Comment("删除数据时间（逻辑删除）"),
	}
}
