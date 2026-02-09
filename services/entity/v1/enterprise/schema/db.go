package schema

import (
	"github.com/zodileap/taurus_go/entity"
	"github.com/zodileap/taurus_go/entity/dialect"

	_ "github.com/zodileap/taurus_go/entity/codegen"
)

type Enterprise struct {
	entity.Database
	Enterprise       *EnterpriseEntity
	EnterpriseMember *EnterpriseMemberEntity
	EnterpriseRole   *EnterpriseRoleEntity
}

func (d *Enterprise) Config() entity.DbConfig {
	return entity.DbConfig{
		Name: "enterprise",
		Tag:  "enterprise",
		Type: dialect.PostgreSQL,
		Triggers: []entity.TriggerConfig{
			{Name: "update_enterprise_last_at", Table: "enterprise", Timing: "BEFORE", Event: "UPDATE", Level: "FOR EACH ROW", Function: `NEW.last_at = CURRENT_TIMESTAMP; RETURN NEW;`},
			{Name: "update_enterprise_member_last_at", Table: "enterprise_member", Timing: "BEFORE", Event: "UPDATE", Level: "FOR EACH ROW", Function: `NEW.last_at = CURRENT_TIMESTAMP; RETURN NEW;`},
			{Name: "update_enterprise_role_last_at", Table: "enterprise_role", Timing: "BEFORE", Event: "UPDATE", Level: "FOR EACH ROW", Function: `NEW.last_at = CURRENT_TIMESTAMP; RETURN NEW;`},
		},
	}
}

func (d *Enterprise) Relationships() []entity.RelationshipBuilder {
	return []entity.RelationshipBuilder{}
}
