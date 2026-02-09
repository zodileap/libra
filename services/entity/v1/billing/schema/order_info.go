package schema

import (
	zspecs "git.zodileap.com/taurus/zodileap_go_zspecs"
	"github.com/zodileap/taurus_go/entity"
)

type OrderInfoEntity struct {
	entity.Entity
	Id          *zspecs.IdE          `json:"id"`
	UserId      *zspecs.UserIdE      `json:"user_id"`
	OrderNo     *zspecs.CodeE        `json:"order_no"`
	OrderType   *zspecs.StatusE      `json:"order_type"`
	Status      *zspecs.StatusE      `json:"status"`
	TotalAmount *zspecs.UsageAmountE `json:"total_amount"`
	CreatedAt   *zspecs.CreatedAtE   `json:"created_at"`
	LastAt      *zspecs.LastAtE      `json:"last_at"`
	DeletedAt   *zspecs.DeletedAtE   `json:"deleted_at,omitempty"`
}

func (e *OrderInfoEntity) Config() entity.EntityConfig {
	return entity.EntityConfig{AttrName: "order_info", Comment: "订单信息"}
}

func (e *OrderInfoEntity) Fields() []entity.FieldBuilder {
	return []entity.FieldBuilder{
		e.Id.Name("id").Primary(1).Sequence(entity.NewSequence("order_info_id_seq")).Comment("主键Id"),
		e.UserId.Name("user_id").Required().Comment("用户Id"),
		e.OrderNo.Name("order_no").MaxLen(128).Required().Comment("订单号"),
		e.OrderType.Name("order_type").Default(1).Comment("订单类型"),
		e.Status.Name("status").Default(1).Comment("订单状态"),
		e.TotalAmount.Name("total_amount").Default(0).Comment("订单总金额"),
		e.CreatedAt.Name("created_at").Default("CURRENT_TIMESTAMP").Precision(6).Comment("创建数据时间"),
		e.LastAt.Name("last_at").Default("CURRENT_TIMESTAMP").Precision(6).Comment("更新数据时间"),
		e.DeletedAt.Name("deleted_at").Default("NULL").Precision(6).Comment("删除数据时间（逻辑删除）"),
	}
}
