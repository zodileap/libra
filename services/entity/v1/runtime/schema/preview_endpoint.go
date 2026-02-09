package schema

import (
	zspecs "git.zodileap.com/taurus/zodileap_go_zspecs"
	"github.com/zodileap/taurus_go/entity"
)

type PreviewEndpointEntity struct {
	entity.Entity
	Id         *zspecs.IdE         `json:"id"`
	SandboxId  *zspecs.IdE         `json:"sandbox_id"`
	Url        *zspecs.UrlE        `json:"url"`
	Status     *zspecs.StatusE     `json:"status"`
	Expiration *zspecs.ExpirationE `json:"expiration"`
	CreatedAt  *zspecs.CreatedAtE  `json:"created_at"`
	LastAt     *zspecs.LastAtE     `json:"last_at"`
	DeletedAt  *zspecs.DeletedAtE  `json:"deleted_at,omitempty"`
}

func (e *PreviewEndpointEntity) Config() entity.EntityConfig {
	return entity.EntityConfig{AttrName: "preview_endpoint", Comment: "预览地址"}
}

func (e *PreviewEndpointEntity) Fields() []entity.FieldBuilder {
	return []entity.FieldBuilder{
		e.Id.Name("id").Primary(1).Sequence(entity.NewSequence("preview_endpoint_id_seq")).Comment("主键Id"),
		e.SandboxId.Name("sandbox_id").Required().Comment("沙盒实例Id"),
		e.Url.Name("url").MaxLen(512).Required().Comment("预览URL"),
		e.Status.Name("status").Default(1).Comment("状态"),
		e.Expiration.Name("expiration").Default(0).Comment("过期时间（秒）"),
		e.CreatedAt.Name("created_at").Default("CURRENT_TIMESTAMP").Precision(6).Comment("创建数据时间"),
		e.LastAt.Name("last_at").Default("CURRENT_TIMESTAMP").Precision(6).Comment("更新数据时间"),
		e.DeletedAt.Name("deleted_at").Default("NULL").Precision(6).Comment("删除数据时间（逻辑删除）"),
	}
}
