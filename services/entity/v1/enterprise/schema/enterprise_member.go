package schema

import (
	zspecs "git.zodileap.com/taurus/zodileap_go_zspecs"
	"github.com/zodileap/taurus_go/entity"
)

type EnterpriseMemberEntity struct {
	entity.Entity
	Id           *zspecs.IdE        `json:"id"`
	EnterpriseId *zspecs.IdE        `json:"enterprise_id"`
	UserId       *zspecs.UserIdE    `json:"user_id"`
	RoleCode     *zspecs.CodeE      `json:"role_code"`
	Status       *zspecs.StatusE    `json:"status"`
	CreatedAt    *zspecs.CreatedAtE `json:"created_at"`
	LastAt       *zspecs.LastAtE    `json:"last_at"`
	DeletedAt    *zspecs.DeletedAtE `json:"deleted_at,omitempty"`
}

func (e *EnterpriseMemberEntity) Config() entity.EntityConfig {
	return entity.EntityConfig{AttrName: "enterprise_member", Comment: "企业成员"}
}

func (e *EnterpriseMemberEntity) Fields() []entity.FieldBuilder {
	return []entity.FieldBuilder{
		e.Id.Name("id").Primary(1).Sequence(entity.NewSequence("enterprise_member_id_seq")).Comment("主键Id"),
		e.EnterpriseId.Name("enterprise_id").Required().Comment("企业Id"),
		e.UserId.Name("user_id").Required().Comment("用户Id"),
		e.RoleCode.Name("role_code").MaxLen(128).Comment("角色编码"),
		e.Status.Name("status").Default(1).Comment("状态"),
		e.CreatedAt.Name("created_at").Default("CURRENT_TIMESTAMP").Precision(6).Comment("创建数据时间"),
		e.LastAt.Name("last_at").Default("CURRENT_TIMESTAMP").Precision(6).Comment("更新数据时间"),
		e.DeletedAt.Name("deleted_at").Default("NULL").Precision(6).Comment("删除数据时间（逻辑删除）"),
	}
}
