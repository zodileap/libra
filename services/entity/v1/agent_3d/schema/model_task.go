package schema

import (
	zspecs "git.zodileap.com/taurus/zodileap_go_zspecs"
	"github.com/zodileap/taurus_go/entity"
)

type ModelTaskEntity struct {
	entity.Entity
	Id         *zspecs.IdE        `json:"id"`
	UserId     *zspecs.UserIdE    `json:"user_id"`
	Prompt     *zspecs.RemarkE    `json:"prompt"`
	Status     *zspecs.StatusE    `json:"status"`
	ResultPath *zspecs.PathE      `json:"result_path"`
	CreatedAt  *zspecs.CreatedAtE `json:"created_at"`
	LastAt     *zspecs.LastAtE    `json:"last_at"`
	DeletedAt  *zspecs.DeletedAtE `json:"deleted_at,omitempty"`
}

func (e *ModelTaskEntity) Config() entity.EntityConfig {
	return entity.EntityConfig{AttrName: "model_task", Comment: "三维任务"}
}

func (e *ModelTaskEntity) Fields() []entity.FieldBuilder {
	return []entity.FieldBuilder{
		e.Id.Name("id").Primary(1).Sequence(entity.NewSequence("model_task_id_seq")).Comment("主键Id"),
		e.UserId.Name("user_id").Required().Comment("用户Id"),
		e.Prompt.Name("prompt").MaxLen(2048).Comment("任务描述"),
		e.Status.Name("status").Default(1).Comment("任务状态"),
		e.ResultPath.Name("result_path").MaxLen(512).Comment("结果路径"),
		e.CreatedAt.Name("created_at").Default("CURRENT_TIMESTAMP").Precision(6).Comment("创建数据时间"),
		e.LastAt.Name("last_at").Default("CURRENT_TIMESTAMP").Precision(6).Comment("更新数据时间"),
		e.DeletedAt.Name("deleted_at").Default("NULL").Precision(6).Comment("删除数据时间（逻辑删除）"),
	}
}
