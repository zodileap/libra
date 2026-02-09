package schema

import (
	zspecs "git.zodileap.com/taurus/zodileap_go_zspecs"
	"github.com/zodileap/taurus_go/entity"
)

type EnterpriseRoleEntity struct {
	entity.Entity
	Id           *zspecs.IdE        `json:"id"`
	EnterpriseId *zspecs.IdE        `json:"enterprise_id"`
	Code         *zspecs.CodeE      `json:"code"`
	Name         *zspecs.NameE      `json:"name"`
	Status       *zspecs.StatusE    `json:"status"`
	Remark       *zspecs.RemarkE    `json:"remark"`
	CreatedAt    *zspecs.CreatedAtE `json:"created_at"`
	LastAt       *zspecs.LastAtE    `json:"last_at"`
	DeletedAt    *zspecs.DeletedAtE `json:"deleted_at,omitempty"`
}

func (e *EnterpriseRoleEntity) Config() entity.EntityConfig {
	return entity.EntityConfig{AttrName: "enterprise_role", Comment: "企业角色"}
}

func (e *EnterpriseRoleEntity) Fields() []entity.FieldBuilder {
	return []entity.FieldBuilder{
		e.Id.Name("id").Primary(1).Sequence(entity.NewSequence("enterprise_role_id_seq")).Comment("主键Id"),
		e.EnterpriseId.Name("enterprise_id").Required().Comment("企业Id"),
		e.Code.Name("code").MaxLen(128).Required().Comment("角色编码"),
		e.Name.Name("name").MaxLen(255).Required().Comment("角色名称"),
		e.Status.Name("status").Default(1).Comment("状态"),
		e.Remark.Name("remark").MaxLen(1024).Comment("备注"),
		e.CreatedAt.Name("created_at").Default("CURRENT_TIMESTAMP").Precision(6).Comment("创建数据时间"),
		e.LastAt.Name("last_at").Default("CURRENT_TIMESTAMP").Precision(6).Comment("更新数据时间"),
		e.DeletedAt.Name("deleted_at").Default("NULL").Precision(6).Comment("删除数据时间（逻辑删除）"),
	}
}
