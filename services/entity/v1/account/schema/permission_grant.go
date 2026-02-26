package schema

import (
	zspecs "git.zodileap.com/taurus/zodileap_go_zspecs"
	"github.com/zodileap/taurus_go/entity"
)

type PermissionGrantEntity struct {
	entity.Entity
	Id             *zspecs.IdE        `json:"id"`
	ActorUserId    *zspecs.UserIdE    `json:"actor_user_id"`
	TargetUserId   *zspecs.UserIdE    `json:"target_user_id"`
	TargetUserName *zspecs.UserNameE  `json:"target_user_name"`
	PermissionCode *zspecs.CodeE      `json:"permission_code"`
	ResourceType   *zspecs.CodeE      `json:"resource_type"`
	ResourceName   *zspecs.NameE      `json:"resource_name"`
	GrantedBy      *zspecs.UserIdE    `json:"granted_by"`
	Status         *zspecs.StatusE    `json:"status"`
	ExpiresAt      *zspecs.RemarkE    `json:"expires_at"`
	CreatedAt      *zspecs.CreatedAtE `json:"created_at"`
	LastAt         *zspecs.LastAtE    `json:"last_at"`
	DeletedAt      *zspecs.DeletedAtE `json:"deleted_at,omitempty"`
}

func (e *PermissionGrantEntity) Config() entity.EntityConfig {
	return entity.EntityConfig{AttrName: "permission_grant", Comment: "权限授权记录"}
}

func (e *PermissionGrantEntity) Fields() []entity.FieldBuilder {
	return []entity.FieldBuilder{
		e.Id.Name("id").Primary(1).Sequence(entity.NewSequence("permission_grant_id_seq")).Comment("主键Id"),
		e.ActorUserId.Name("actor_user_id").Required().Comment("操作人用户Id"),
		e.TargetUserId.Name("target_user_id").Required().Comment("目标用户Id"),
		e.TargetUserName.Name("target_user_name").MaxLen(255).Required().Comment("目标用户名称"),
		e.PermissionCode.Name("permission_code").MaxLen(128).Required().Comment("权限编码"),
		e.ResourceType.Name("resource_type").MaxLen(128).Required().Comment("资源类型"),
		e.ResourceName.Name("resource_name").MaxLen(255).Required().Comment("资源名称"),
		e.GrantedBy.Name("granted_by").Comment("授权人用户Id"),
		e.Status.Name("status").Default(1).Comment("状态"),
		e.ExpiresAt.Name("expires_at").MaxLen(1024).Comment("过期时间"),
		e.CreatedAt.Name("created_at").Default("CURRENT_TIMESTAMP").Precision(6).Comment("创建数据时间"),
		e.LastAt.Name("last_at").Default("CURRENT_TIMESTAMP").Precision(6).Comment("更新数据时间"),
		e.DeletedAt.Name("deleted_at").Default("NULL").Precision(6).Comment("删除数据时间（逻辑删除）"),
	}
}
