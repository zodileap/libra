package schema

import (
	zspecs "git.zodileap.com/taurus/zodileap_go_zspecs"
	"github.com/zodileap/taurus_go/entity"
)

type ModelResultEntity struct {
	entity.Entity
	Id        *zspecs.IdE        `json:"id"`
	TaskId    *zspecs.IdE        `json:"task_id"`
	Format    *zspecs.CodeE      `json:"format"`
	FilePath  *zspecs.PathE      `json:"file_path"`
	Status    *zspecs.StatusE    `json:"status"`
	CreatedAt *zspecs.CreatedAtE `json:"created_at"`
	LastAt    *zspecs.LastAtE    `json:"last_at"`
	DeletedAt *zspecs.DeletedAtE `json:"deleted_at,omitempty"`
}

func (e *ModelResultEntity) Config() entity.EntityConfig {
	return entity.EntityConfig{AttrName: "model_result", Comment: "三维结果"}
}

func (e *ModelResultEntity) Fields() []entity.FieldBuilder {
	return []entity.FieldBuilder{
		e.Id.Name("id").Primary(1).Sequence(entity.NewSequence("model_result_id_seq")).Comment("主键Id"),
		e.TaskId.Name("task_id").Required().Comment("任务Id"),
		e.Format.Name("format").MaxLen(64).Comment("结果格式"),
		e.FilePath.Name("file_path").MaxLen(512).Comment("文件路径"),
		e.Status.Name("status").Default(1).Comment("状态"),
		e.CreatedAt.Name("created_at").Default("CURRENT_TIMESTAMP").Precision(6).Comment("创建数据时间"),
		e.LastAt.Name("last_at").Default("CURRENT_TIMESTAMP").Precision(6).Comment("更新数据时间"),
		e.DeletedAt.Name("deleted_at").Default("NULL").Precision(6).Comment("删除数据时间（逻辑删除）"),
	}
}
