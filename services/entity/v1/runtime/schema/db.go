package schema

import (
	"github.com/zodileap/taurus_go/entity"
	"github.com/zodileap/taurus_go/entity/dialect"

	_ "github.com/zodileap/taurus_go/entity/codegen"
)

type Runtime struct {
	entity.Database
	AgentSession    *AgentSessionEntity
	SandboxInstance *SandboxInstanceEntity
	PreviewEndpoint *PreviewEndpointEntity
}

func (d *Runtime) Config() entity.DbConfig {
	return entity.DbConfig{
		Name: "runtime",
		Tag:  "runtime",
		Type: dialect.PostgreSQL,
		Triggers: []entity.TriggerConfig{
			{Name: "update_agent_session_last_at", Table: "agent_session", Timing: "BEFORE", Event: "UPDATE", Level: "FOR EACH ROW", Function: `NEW.last_at = CURRENT_TIMESTAMP; RETURN NEW;`},
			{Name: "update_sandbox_instance_last_at", Table: "sandbox_instance", Timing: "BEFORE", Event: "UPDATE", Level: "FOR EACH ROW", Function: `NEW.last_at = CURRENT_TIMESTAMP; RETURN NEW;`},
			{Name: "update_preview_endpoint_last_at", Table: "preview_endpoint", Timing: "BEFORE", Event: "UPDATE", Level: "FOR EACH ROW", Function: `NEW.last_at = CURRENT_TIMESTAMP; RETURN NEW;`},
		},
	}
}

func (d *Runtime) Relationships() []entity.RelationshipBuilder {
	return []entity.RelationshipBuilder{}
}
