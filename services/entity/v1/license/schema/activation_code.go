package schema

import (
	zspecs "git.zodileap.com/taurus/zodileap_go_zspecs"
	"github.com/zodileap/taurus_go/entity"
)

type ActivationCodeEntity struct {
	entity.Entity
	Id         *zspecs.IdE         `json:"id"`
	Code       *zspecs.CodeE       `json:"code"`
	AgentCode  *zspecs.CodeE       `json:"agent_code"`
	UserId     *zspecs.UserIdE     `json:"user_id"`
	Status     *zspecs.StatusE     `json:"status"`
	Expiration *zspecs.ExpirationE `json:"expiration"`
	CreatedAt  *zspecs.CreatedAtE  `json:"created_at"`
	LastAt     *zspecs.LastAtE     `json:"last_at"`
	DeletedAt  *zspecs.DeletedAtE  `json:"deleted_at,omitempty"`
}

func (e *ActivationCodeEntity) Config() entity.EntityConfig {
	return entity.EntityConfig{AttrName: "activation_code", Comment: "激活码"}
}

func (e *ActivationCodeEntity) Fields() []entity.FieldBuilder {
	return []entity.FieldBuilder{
		e.Id.Name("id").Primary(1).Sequence(entity.NewSequence("activation_code_id_seq")).Comment("主键Id"),
		e.Code.Name("code").MaxLen(128).Required().Comment("激活码"),
		e.AgentCode.Name("agent_code").MaxLen(128).Required().Comment("智能体编码"),
		e.UserId.Name("user_id").Comment("用户Id"),
		e.Status.Name("status").Default(1).Comment("状态"),
		e.Expiration.Name("expiration").Default(0).Comment("过期时间（秒）"),
		e.CreatedAt.Name("created_at").Default("CURRENT_TIMESTAMP").Precision(6).Comment("创建数据时间"),
		e.LastAt.Name("last_at").Default("CURRENT_TIMESTAMP").Precision(6).Comment("更新数据时间"),
		e.DeletedAt.Name("deleted_at").Default("NULL").Precision(6).Comment("删除数据时间（逻辑删除）"),
	}
}
