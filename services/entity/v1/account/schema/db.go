package schema

import (
	"github.com/zodileap/taurus_go/entity"
	"github.com/zodileap/taurus_go/entity/dialect"

	_ "github.com/zodileap/taurus_go/entity/codegen"
)

type Account struct {
	entity.Database
	User        *UserEntity
	Agent       *AgentEntity
	AgentAccess *AgentAccessEntity
}

func (d *Account) Config() entity.DbConfig {
	return entity.DbConfig{
		Name: "account",
		Tag:  "account",
		Type: dialect.PostgreSQL,
		Triggers: []entity.TriggerConfig{
			{Name: "update_user_info_last_at", Table: "user_info", Timing: "BEFORE", Event: "UPDATE", Level: "FOR EACH ROW", Function: `NEW.last_at = CURRENT_TIMESTAMP; RETURN NEW;`},
			{Name: "update_agent_last_at", Table: "agent", Timing: "BEFORE", Event: "UPDATE", Level: "FOR EACH ROW", Function: `NEW.last_at = CURRENT_TIMESTAMP; RETURN NEW;`},
			{Name: "update_agent_access_last_at", Table: "agent_access", Timing: "BEFORE", Event: "UPDATE", Level: "FOR EACH ROW", Function: `NEW.last_at = CURRENT_TIMESTAMP; RETURN NEW;`},
		},
	}
}

func (d *Account) Relationships() []entity.RelationshipBuilder {
	return []entity.RelationshipBuilder{}
}
