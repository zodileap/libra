package schema

import (
	zspecs "git.zodileap.com/taurus/zodileap_go_zspecs"
	"github.com/zodileap/taurus_go/entity"
)

type FrameworkAssetEntity struct {
	entity.Entity
	Id        *zspecs.IdE        `json:"id"`
	OwnerId   *zspecs.UserIdE    `json:"owner_id"`
	Name      *zspecs.NameE      `json:"name"`
	GitUrl    *zspecs.UrlE       `json:"git_url"`
	Version   *zspecs.VersionE   `json:"version"`
	Status    *zspecs.StatusE    `json:"status"`
	Remark    *zspecs.RemarkE    `json:"remark"`
	CreatedAt *zspecs.CreatedAtE `json:"created_at"`
	LastAt    *zspecs.LastAtE    `json:"last_at"`
	DeletedAt *zspecs.DeletedAtE `json:"deleted_at,omitempty"`
}

func (e *FrameworkAssetEntity) Config() entity.EntityConfig {
	return entity.EntityConfig{AttrName: "framework_asset", Comment: "框架资产"}
}

func (e *FrameworkAssetEntity) Fields() []entity.FieldBuilder {
	return []entity.FieldBuilder{
		e.Id.Name("id").Primary(1).Sequence(entity.NewSequence("framework_asset_id_seq")).Comment("主键Id"),
		e.OwnerId.Name("owner_id").Comment("所属用户Id"),
		e.Name.Name("name").MaxLen(255).Required().Comment("资产名称"),
		e.GitUrl.Name("git_url").MaxLen(512).Comment("Git地址"),
		e.Version.Name("version").MaxLen(64).Comment("版本"),
		e.Status.Name("status").Default(1).Comment("状态"),
		e.Remark.Name("remark").MaxLen(1024).Comment("备注"),
		e.CreatedAt.Name("created_at").Default("CURRENT_TIMESTAMP").Precision(6).Comment("创建数据时间"),
		e.LastAt.Name("last_at").Default("CURRENT_TIMESTAMP").Precision(6).Comment("更新数据时间"),
		e.DeletedAt.Name("deleted_at").Default("NULL").Precision(6).Comment("删除数据时间（逻辑删除）"),
	}
}
