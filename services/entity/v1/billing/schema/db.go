package schema

import (
	"github.com/zodileap/taurus_go/entity"
	"github.com/zodileap/taurus_go/entity/dialect"

	_ "github.com/zodileap/taurus_go/entity/codegen"
)

type Billing struct {
	entity.Database
	Subscription *SubscriptionEntity
	OrderInfo    *OrderInfoEntity
	OrderItem    *OrderItemEntity
}

func (d *Billing) Config() entity.DbConfig {
	return entity.DbConfig{
		Name: "billing",
		Tag:  "billing",
		Type: dialect.PostgreSQL,
		Triggers: []entity.TriggerConfig{
			{Name: "update_subscription_last_at", Table: "subscription", Timing: "BEFORE", Event: "UPDATE", Level: "FOR EACH ROW", Function: `NEW.last_at = CURRENT_TIMESTAMP; RETURN NEW;`},
			{Name: "update_order_info_last_at", Table: "order_info", Timing: "BEFORE", Event: "UPDATE", Level: "FOR EACH ROW", Function: `NEW.last_at = CURRENT_TIMESTAMP; RETURN NEW;`},
			{Name: "update_order_item_last_at", Table: "order_item", Timing: "BEFORE", Event: "UPDATE", Level: "FOR EACH ROW", Function: `NEW.last_at = CURRENT_TIMESTAMP; RETURN NEW;`},
		},
	}
}

func (d *Billing) Relationships() []entity.RelationshipBuilder {
	return []entity.RelationshipBuilder{}
}
