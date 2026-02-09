package schema

import (
	zspecs "git.zodileap.com/taurus/zodileap_go_zspecs"
	"github.com/zodileap/taurus_go/entity"
)

type SandboxInstanceEntity struct {
	entity.Entity
	Id          *zspecs.IdE        `json:"id"`
	SessionId   *zspecs.IdE        `json:"session_id"`
	ContainerId *zspecs.CodeE      `json:"container_id"`
	PreviewUrl  *zspecs.UrlE       `json:"preview_url"`
	Status      *zspecs.StatusE    `json:"status"`
	CreatedAt   *zspecs.CreatedAtE `json:"created_at"`
	LastAt      *zspecs.LastAtE    `json:"last_at"`
	DeletedAt   *zspecs.DeletedAtE `json:"deleted_at,omitempty"`
}

func (e *SandboxInstanceEntity) Config() entity.EntityConfig {
	return entity.EntityConfig{AttrName: "sandbox_instance", Comment: "沙盒实例"}
}

func (e *SandboxInstanceEntity) Fields() []entity.FieldBuilder {
	return []entity.FieldBuilder{
		e.Id.Name("id").Primary(1).Sequence(entity.NewSequence("sandbox_instance_id_seq")).Comment("主键Id"),
		e.SessionId.Name("session_id").Required().Comment("会话Id"),
		e.ContainerId.Name("container_id").MaxLen(255).Comment("容器Id"),
		e.PreviewUrl.Name("preview_url").MaxLen(512).Comment("预览地址"),
		e.Status.Name("status").Default(1).Comment("状态"),
		e.CreatedAt.Name("created_at").Default("CURRENT_TIMESTAMP").Precision(6).Comment("创建数据时间"),
		e.LastAt.Name("last_at").Default("CURRENT_TIMESTAMP").Precision(6).Comment("更新数据时间"),
		e.DeletedAt.Name("deleted_at").Default("NULL").Precision(6).Comment("删除数据时间（逻辑删除）"),
	}
}
