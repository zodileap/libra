package schema

import (
	zspecs "git.zodileap.com/taurus/zodileap_go_zspecs"
	"github.com/zodileap/taurus_go/entity"
)

type DccBindingEntity struct {
	entity.Entity
	Id             *zspecs.IdE        `json:"id"`
	UserId         *zspecs.UserIdE    `json:"user_id"`
	Software       *zspecs.CodeE      `json:"software"`
	Version        *zspecs.VersionE   `json:"version"`
	ExecutablePath *zspecs.PathE      `json:"executable_path"`
	Status         *zspecs.StatusE    `json:"status"`
	CreatedAt      *zspecs.CreatedAtE `json:"created_at"`
	LastAt         *zspecs.LastAtE    `json:"last_at"`
	DeletedAt      *zspecs.DeletedAtE `json:"deleted_at,omitempty"`
}

func (e *DccBindingEntity) Config() entity.EntityConfig {
	return entity.EntityConfig{AttrName: "dcc_binding", Comment: "DCC软件绑定"}
}

func (e *DccBindingEntity) Fields() []entity.FieldBuilder {
	return []entity.FieldBuilder{
		e.Id.Name("id").Primary(1).Sequence(entity.NewSequence("dcc_binding_id_seq")).Comment("主键Id"),
		e.UserId.Name("user_id").Required().Comment("用户Id"),
		e.Software.Name("software").MaxLen(64).Required().Comment("软件标识"),
		e.Version.Name("version").MaxLen(64).Comment("软件版本"),
		e.ExecutablePath.Name("executable_path").MaxLen(512).Comment("可执行文件路径"),
		e.Status.Name("status").Default(1).Comment("状态"),
		e.CreatedAt.Name("created_at").Default("CURRENT_TIMESTAMP").Precision(6).Comment("创建数据时间"),
		e.LastAt.Name("last_at").Default("CURRENT_TIMESTAMP").Precision(6).Comment("更新数据时间"),
		e.DeletedAt.Name("deleted_at").Default("NULL").Precision(6).Comment("删除数据时间（逻辑删除）"),
	}
}
