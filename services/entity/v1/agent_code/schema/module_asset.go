package schema

import (
	zspecs "git.zodileap.com/taurus/zodileap_go_zspecs"
	"github.com/zodileap/taurus_go/entity"
)

type ModuleAssetEntity struct {
	entity.Entity
	Id        *zspecs.IdE        `json:"id"`
	OwnerId   *zspecs.UserIdE    `json:"owner_id"`
	Name      *zspecs.NameE      `json:"name"`
	Path      *zspecs.PathE      `json:"path"`
	Version   *zspecs.VersionE   `json:"version"`
	Status    *zspecs.StatusE    `json:"status"`
	Remark    *zspecs.RemarkE    `json:"remark"`
	CreatedAt *zspecs.CreatedAtE `json:"created_at"`
	LastAt    *zspecs.LastAtE    `json:"last_at"`
	DeletedAt *zspecs.DeletedAtE `json:"deleted_at,omitempty"`
}

func (e *ModuleAssetEntity) Config() entity.EntityConfig {
	return entity.EntityConfig{AttrName: "module_asset", Comment: "代码模块资产"}
}

func (e *ModuleAssetEntity) Fields() []entity.FieldBuilder {
	return []entity.FieldBuilder{
		e.Id.Name("id").Primary(1).Sequence(entity.NewSequence("module_asset_id_seq")).Comment("主键Id"),
		e.OwnerId.Name("owner_id").Comment("所属用户Id"),
		e.Name.Name("name").MaxLen(255).Required().Comment("模块名称"),
		e.Path.Name("path").MaxLen(512).Comment("源码路径"),
		e.Version.Name("version").MaxLen(64).Comment("版本"),
		e.Status.Name("status").Default(1).Comment("状态"),
		e.Remark.Name("remark").MaxLen(1024).Comment("备注"),
		e.CreatedAt.Name("created_at").Default("CURRENT_TIMESTAMP").Precision(6).Comment("创建数据时间"),
		e.LastAt.Name("last_at").Default("CURRENT_TIMESTAMP").Precision(6).Comment("更新数据时间"),
		e.DeletedAt.Name("deleted_at").Default("NULL").Precision(6).Comment("删除数据时间（逻辑删除）"),
	}
}
