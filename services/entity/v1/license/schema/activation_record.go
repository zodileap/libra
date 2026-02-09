package schema

import (
	zspecs "git.zodileap.com/taurus/zodileap_go_zspecs"
	"github.com/zodileap/taurus_go/entity"
)

type ActivationRecordEntity struct {
	entity.Entity
	Id               *zspecs.IdE        `json:"id"`
	ActivationCodeId *zspecs.IdE        `json:"activation_code_id"`
	UserId           *zspecs.UserIdE    `json:"user_id"`
	DeviceId         *zspecs.DeviceIdE  `json:"device_id"`
	Status           *zspecs.StatusE    `json:"status"`
	Remark           *zspecs.RemarkE    `json:"remark"`
	CreatedAt        *zspecs.CreatedAtE `json:"created_at"`
	LastAt           *zspecs.LastAtE    `json:"last_at"`
	DeletedAt        *zspecs.DeletedAtE `json:"deleted_at,omitempty"`
}

func (e *ActivationRecordEntity) Config() entity.EntityConfig {
	return entity.EntityConfig{AttrName: "activation_record", Comment: "激活记录"}
}

func (e *ActivationRecordEntity) Fields() []entity.FieldBuilder {
	return []entity.FieldBuilder{
		e.Id.Name("id").Primary(1).Sequence(entity.NewSequence("activation_record_id_seq")).Comment("主键Id"),
		e.ActivationCodeId.Name("activation_code_id").Required().Comment("激活码Id"),
		e.UserId.Name("user_id").Required().Comment("用户Id"),
		e.DeviceId.Name("device_id").MaxLen(255).Comment("设备Id"),
		e.Status.Name("status").Default(1).Comment("状态"),
		e.Remark.Name("remark").MaxLen(1024).Comment("备注"),
		e.CreatedAt.Name("created_at").Default("CURRENT_TIMESTAMP").Precision(6).Comment("创建数据时间"),
		e.LastAt.Name("last_at").Default("CURRENT_TIMESTAMP").Precision(6).Comment("更新数据时间"),
		e.DeletedAt.Name("deleted_at").Default("NULL").Precision(6).Comment("删除数据时间（逻辑删除）"),
	}
}
