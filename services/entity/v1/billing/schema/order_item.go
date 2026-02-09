package schema

import (
	zspecs "git.zodileap.com/taurus/zodileap_go_zspecs"
	"github.com/zodileap/taurus_go/entity"
)

type OrderItemEntity struct {
	entity.Entity
	Id         *zspecs.IdE          `json:"id"`
	OrderId    *zspecs.IdE          `json:"order_id"`
	AgentCode  *zspecs.CodeE        `json:"agent_code"`
	Quantity   *zspecs.DurationE    `json:"quantity"`
	ItemAmount *zspecs.UsageAmountE `json:"item_amount"`
	CreatedAt  *zspecs.CreatedAtE   `json:"created_at"`
	LastAt     *zspecs.LastAtE      `json:"last_at"`
	DeletedAt  *zspecs.DeletedAtE   `json:"deleted_at,omitempty"`
}

func (e *OrderItemEntity) Config() entity.EntityConfig {
	return entity.EntityConfig{AttrName: "order_item", Comment: "订单项"}
}

func (e *OrderItemEntity) Fields() []entity.FieldBuilder {
	return []entity.FieldBuilder{
		e.Id.Name("id").Primary(1).Sequence(entity.NewSequence("order_item_id_seq")).Comment("主键Id"),
		e.OrderId.Name("order_id").Required().Comment("订单Id"),
		e.AgentCode.Name("agent_code").MaxLen(128).Required().Comment("智能体编码"),
		e.Quantity.Name("quantity").Default(1).Comment("购买数量"),
		e.ItemAmount.Name("item_amount").Default(0).Comment("明细金额"),
		e.CreatedAt.Name("created_at").Default("CURRENT_TIMESTAMP").Precision(6).Comment("创建数据时间"),
		e.LastAt.Name("last_at").Default("CURRENT_TIMESTAMP").Precision(6).Comment("更新数据时间"),
		e.DeletedAt.Name("deleted_at").Default("NULL").Precision(6).Comment("删除数据时间（逻辑删除）"),
	}
}
