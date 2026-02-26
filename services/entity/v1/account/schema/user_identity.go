package schema

import (
	zspecs "git.zodileap.com/taurus/zodileap_go_zspecs"
	"github.com/zodileap/taurus_go/entity"
)

type UserIdentityEntity struct {
	entity.Entity
	Id           *zspecs.IdE        `json:"id"`
	UserId       *zspecs.UserIdE    `json:"user_id"`
	IdentityType *zspecs.CodeE      `json:"identity_type"`
	ScopeCode    *zspecs.CodeE      `json:"scope_code"`
	ScopeName    *zspecs.NameE      `json:"scope_name"`
	RoleCodes    *zspecs.RemarkE    `json:"role_codes"`
	Status       *zspecs.StatusE    `json:"status"`
	CreatedAt    *zspecs.CreatedAtE `json:"created_at"`
	LastAt       *zspecs.LastAtE    `json:"last_at"`
	DeletedAt    *zspecs.DeletedAtE `json:"deleted_at,omitempty"`
}

func (e *UserIdentityEntity) Config() entity.EntityConfig {
	return entity.EntityConfig{AttrName: "user_identity", Comment: "用户身份"}
}

func (e *UserIdentityEntity) Fields() []entity.FieldBuilder {
	return []entity.FieldBuilder{
		e.Id.Name("id").Primary(1).Sequence(entity.NewSequence("user_identity_id_seq")).Comment("主键Id"),
		e.UserId.Name("user_id").Required().Comment("用户Id"),
		e.IdentityType.Name("identity_type").MaxLen(128).Required().Comment("身份类型"),
		e.ScopeCode.Name("scope_code").MaxLen(128).Required().Comment("作用域编码"),
		e.ScopeName.Name("scope_name").MaxLen(255).Required().Comment("作用域名称"),
		e.RoleCodes.Name("role_codes").MaxLen(1024).Comment("角色编码集合（逗号分隔）"),
		e.Status.Name("status").Default(1).Comment("状态"),
		e.CreatedAt.Name("created_at").Default("CURRENT_TIMESTAMP").Precision(6).Comment("创建数据时间"),
		e.LastAt.Name("last_at").Default("CURRENT_TIMESTAMP").Precision(6).Comment("更新数据时间"),
		e.DeletedAt.Name("deleted_at").Default("NULL").Precision(6).Comment("删除数据时间（逻辑删除）"),
	}
}
