
/*
    Server Type: PostgreSQL
    Catalogs: agent_code
    Schema: public
*/

-- ********
-- EXTENSION
-- ********
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";


-- ********
-- Delete Foreign Key
-- ********
DO $$
BEGIN

END
$$;


-- ********
-- Sequence component_asset_id_seq
-- ********
DO $$ 
BEGIN     
    -- 创建基础序列
    CREATE SEQUENCE IF NOT EXISTS "public".component_asset_id_seq
        INCREMENT 1
        MINVALUE 1
        MAXVALUE 9223372036854775807
        START 1
        CACHE 1;
    -- 创建随机种子序列
    CREATE SEQUENCE IF NOT EXISTS "public"."component_asset_id_seq_seed"
    INCREMENT 1
    MINVALUE 1
    MAXVALUE 9223372036854775807
    START 1
    CACHE 1;
END $$;
CREATE OR REPLACE FUNCTION "public".component_asset_id_seq() 
RETURNS BIGINT AS $$
DECLARE
    timestamp_part BIGINT;
    sequence_part BIGINT;
    random_part BIGINT;
BEGIN
    -- 获取当前时间戳（毫秒）
    timestamp_part := (extract(epoch from current_timestamp) * 1000)::BIGINT;
    
    -- 获取序列号
    sequence_part := nextval('"public".component_asset_id_seq') % 512;
    
    -- 获取随机数部分
    random_part := nextval('"public".component_asset_id_seq_seed') % 512;
    
    -- 组合TSID：41位时间戳 + 9位序列号 + 9位随机数
    RETURN (timestamp_part << 18) | (sequence_part << 9) | random_part;
END;
$$ LANGUAGE plpgsql;
-- ********
-- Table "component_asset"
-- ********
DO $$
DECLARE
    column_rec RECORD;
    v_constraint_name TEXT;
    v_unique_constraint_name TEXT; 
    v_check_constraint_name TEXT;
BEGIN
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'component_asset') THEN
        -- 删除所有CHECK约束
        FOR v_check_constraint_name IN 
            SELECT conname
            FROM pg_constraint con
            JOIN pg_class rel ON rel.oid = con.conrelid
            JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
            WHERE nsp.nspname = 'public'
                AND rel.relname = 'component_asset'
                AND con.contype = 'c'
        LOOP
            EXECUTE 'ALTER TABLE "public"."component_asset" DROP CONSTRAINT IF EXISTS ' || quote_ident(v_check_constraint_name);
        END LOOP;

        -- Check for any extra columns, and delete them if there are any.
        -- 检查是否有多余的列，如果有则删除。
        FOR column_rec IN SELECT tbl.column_name, tbl.data_type 
            FROM information_schema.columns tbl 
            WHERE table_schema = 'public' 
            AND table_name = 'component_asset' 
        LOOP
            IF column_rec.column_name NOT IN ('id','owner_id','name','path','version','status','remark','created_at','last_at','deleted_at') THEN
                EXECUTE 'ALTER TABLE "public"."component_asset" DROP COLUMN IF EXISTS ' || 
                        quote_ident(column_rec.column_name) || ' CASCADE';
            END IF;
        END LOOP;

        -- Check for missing columns, and add them if any are missing.
        -- 检查是否缺少列，如果缺少则添加
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'component_asset' AND column_name = 'id' ) THEN
            ALTER TABLE "public"."component_asset" ADD COLUMN "id" int8 NOT NULL DEFAULT component_asset_id_seq();
        ELSE
            
            ALTER TABLE "public"."component_asset" ALTER COLUMN "id" SET NOT NULL; 
            ALTER TABLE "public"."component_asset" ALTER COLUMN "id" SET DEFAULT component_asset_id_seq(); ALTER TABLE "public"."component_asset" ALTER COLUMN "id" TYPE int8 USING "id"::int8;
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'component_asset' AND column_name = 'owner_id' ) THEN
            ALTER TABLE "public"."component_asset" ADD COLUMN "owner_id" uuid;
        ELSE
            
            ALTER TABLE "public"."component_asset" ALTER COLUMN "owner_id" DROP NOT NULL; 
            ALTER TABLE "public"."component_asset" ALTER COLUMN "owner_id" DROP DEFAULT; ALTER TABLE "public"."component_asset" ALTER COLUMN "owner_id" TYPE uuid USING "owner_id"::uuid;
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'component_asset' AND column_name = 'name' ) THEN
            ALTER TABLE "public"."component_asset" ADD COLUMN "name" varchar(255) NOT NULL;
        ELSE
            
            ALTER TABLE "public"."component_asset" ALTER COLUMN "name" SET NOT NULL; 
            ALTER TABLE "public"."component_asset" ALTER COLUMN "name" DROP DEFAULT; ALTER TABLE "public"."component_asset" ALTER COLUMN "name" TYPE varchar(255) USING "name"::varchar(255);
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'component_asset' AND column_name = 'path' ) THEN
            ALTER TABLE "public"."component_asset" ADD COLUMN "path" varchar(512);
        ELSE
            
            ALTER TABLE "public"."component_asset" ALTER COLUMN "path" DROP NOT NULL; 
            ALTER TABLE "public"."component_asset" ALTER COLUMN "path" DROP DEFAULT; ALTER TABLE "public"."component_asset" ALTER COLUMN "path" TYPE varchar(512) USING "path"::varchar(512);
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'component_asset' AND column_name = 'version' ) THEN
            ALTER TABLE "public"."component_asset" ADD COLUMN "version" varchar(64);
        ELSE
            
            ALTER TABLE "public"."component_asset" ALTER COLUMN "version" DROP NOT NULL; 
            ALTER TABLE "public"."component_asset" ALTER COLUMN "version" DROP DEFAULT; ALTER TABLE "public"."component_asset" ALTER COLUMN "version" TYPE varchar(64) USING "version"::varchar(64);
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'component_asset' AND column_name = 'status' ) THEN
            ALTER TABLE "public"."component_asset" ADD COLUMN "status" int2 DEFAULT 1;
        ELSE
            
            ALTER TABLE "public"."component_asset" ALTER COLUMN "status" DROP NOT NULL; 
            ALTER TABLE "public"."component_asset" ALTER COLUMN "status" SET DEFAULT 1; ALTER TABLE "public"."component_asset" ALTER COLUMN "status" TYPE int2 USING "status"::int2;
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'component_asset' AND column_name = 'remark' ) THEN
            ALTER TABLE "public"."component_asset" ADD COLUMN "remark" varchar(1024);
        ELSE
            
            ALTER TABLE "public"."component_asset" ALTER COLUMN "remark" DROP NOT NULL; 
            ALTER TABLE "public"."component_asset" ALTER COLUMN "remark" DROP DEFAULT; ALTER TABLE "public"."component_asset" ALTER COLUMN "remark" TYPE varchar(1024) USING "remark"::varchar(1024);
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'component_asset' AND column_name = 'created_at' ) THEN
            ALTER TABLE "public"."component_asset" ADD COLUMN "created_at" timestamptz(6) DEFAULT CURRENT_TIMESTAMP;
        ELSE
            
            ALTER TABLE "public"."component_asset" ALTER COLUMN "created_at" DROP NOT NULL; 
            ALTER TABLE "public"."component_asset" ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP; ALTER TABLE "public"."component_asset" ALTER COLUMN "created_at" TYPE timestamptz(6) USING "created_at"::timestamptz(6);
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'component_asset' AND column_name = 'last_at' ) THEN
            ALTER TABLE "public"."component_asset" ADD COLUMN "last_at" timestamptz(6) DEFAULT CURRENT_TIMESTAMP;
        ELSE
            
            ALTER TABLE "public"."component_asset" ALTER COLUMN "last_at" DROP NOT NULL; 
            ALTER TABLE "public"."component_asset" ALTER COLUMN "last_at" SET DEFAULT CURRENT_TIMESTAMP; ALTER TABLE "public"."component_asset" ALTER COLUMN "last_at" TYPE timestamptz(6) USING "last_at"::timestamptz(6);
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'component_asset' AND column_name = 'deleted_at' ) THEN
            ALTER TABLE "public"."component_asset" ADD COLUMN "deleted_at" timestamptz(6) DEFAULT NULL;
        ELSE
            
            ALTER TABLE "public"."component_asset" ALTER COLUMN "deleted_at" DROP NOT NULL; 
            ALTER TABLE "public"."component_asset" ALTER COLUMN "deleted_at" SET DEFAULT NULL; ALTER TABLE "public"."component_asset" ALTER COLUMN "deleted_at" TYPE timestamptz(6) USING "deleted_at"::timestamptz(6);
        END IF;

        -- Search for existing unique and primary key constraints and drop them
        -- 查找并删除现有的唯一约束和主键约束
        BEGIN
            -- Drop primary key constraint
            -- 删除主键约束
            SELECT conname INTO v_constraint_name
            FROM pg_constraint con
            JOIN pg_class rel ON rel.oid = con.conrelid
            JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
            WHERE nsp.nspname = 'public'
                AND rel.relname = 'component_asset'
                AND con.contype = 'p';
            IF v_constraint_name IS NOT NULL THEN
                EXECUTE 'ALTER TABLE "public"."component_asset" DROP CONSTRAINT IF EXISTS ' || quote_ident(v_constraint_name) || ' CASCADE';
            END IF;

            -- Drop unique constraints
            -- 删除唯一约束
            FOR v_unique_constraint_name IN 
                SELECT conname
                FROM pg_constraint con
                JOIN pg_class rel ON rel.oid = con.conrelid
                JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
                WHERE nsp.nspname = 'public'
                    AND rel.relname = 'component_asset'
                    AND con.contype = 'u'
            LOOP
                BEGIN
                    EXECUTE 'ALTER TABLE "public"."component_asset" DROP CONSTRAINT IF EXISTS ' || quote_ident(v_unique_constraint_name);
                EXCEPTION WHEN OTHERS THEN
                    RAISE NOTICE 'Error dropping unique constraint %: %', v_unique_constraint_name, SQLERRM;
                END;
            END LOOP;
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'Error during dropping primary key or unique constraints: %', SQLERRM;
        END;

        -- 添加所有字段的CHECK约束
    ELSE
        -- If the table does not exist, then create the table.
        -- 如果表不存在，则创建表。
        CREATE TABLE "public"."component_asset" (
            "id" int8 NOT NULL DEFAULT component_asset_id_seq(),
            "owner_id" uuid,
            "name" varchar(255) NOT NULL,
            "path" varchar(512),
            "version" varchar(64),
            "status" int2 DEFAULT 1,
            "remark" varchar(1024),
            "created_at" timestamptz(6) DEFAULT CURRENT_TIMESTAMP,
            "last_at" timestamptz(6) DEFAULT CURRENT_TIMESTAMP,
            "deleted_at" timestamptz(6) DEFAULT NULL
        );
    END IF;
    -- Field Comment.
    -- 字段备注。
    COMMENT ON COLUMN "public"."component_asset"."id" IS  '主键Id';
    COMMENT ON COLUMN "public"."component_asset"."owner_id" IS  '所属用户Id';
    COMMENT ON COLUMN "public"."component_asset"."name" IS  '组件名称';
    COMMENT ON COLUMN "public"."component_asset"."path" IS  '源码路径';
    COMMENT ON COLUMN "public"."component_asset"."version" IS  '版本';
    COMMENT ON COLUMN "public"."component_asset"."status" IS  '状态';
    COMMENT ON COLUMN "public"."component_asset"."remark" IS  '备注';
    COMMENT ON COLUMN "public"."component_asset"."created_at" IS  '创建数据时间';
    COMMENT ON COLUMN "public"."component_asset"."last_at" IS  '更新数据时间';
    COMMENT ON COLUMN "public"."component_asset"."deleted_at" IS  '删除数据时间（逻辑删除）';
    -- Table Comment.
    -- 表备注。
    COMMENT ON TABLE "public"."component_asset" IS '组件资产';

    -- Primary Key.
    -- 主键。
    BEGIN
        IF NOT EXISTS (
            SELECT 1
            FROM pg_constraint con
            JOIN pg_class rel ON rel.oid = con.conrelid
            JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
            WHERE nsp.nspname = 'public'
                AND rel.relname = 'component_asset'
                AND con.contype = 'p'
        ) THEN
            BEGIN
                ALTER TABLE "public"."component_asset" ADD CONSTRAINT component_asset_pkey PRIMARY KEY ("id");
            EXCEPTION 
                WHEN duplicate_table THEN
                    RAISE NOTICE 'Primary key constraint already exists';
                WHEN OTHERS THEN
                    RAISE NOTICE 'Error adding primary key constraint: %', SQLERRM;
            END;
        END IF;
    END;

    -- Add unique constraints
    -- 添加唯一约束
    BEGIN
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'Error during adding unique constraints: %', SQLERRM;
    END;

    -- Add indexes
    -- 添加索引
    BEGIN
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'Error during adding indexes: %', SQLERRM;
    END;
END
$$;

-- ********
-- Sequence framework_asset_id_seq
-- ********
DO $$ 
BEGIN     
    -- 创建基础序列
    CREATE SEQUENCE IF NOT EXISTS "public".framework_asset_id_seq
        INCREMENT 1
        MINVALUE 1
        MAXVALUE 9223372036854775807
        START 1
        CACHE 1;
    -- 创建随机种子序列
    CREATE SEQUENCE IF NOT EXISTS "public"."framework_asset_id_seq_seed"
    INCREMENT 1
    MINVALUE 1
    MAXVALUE 9223372036854775807
    START 1
    CACHE 1;
END $$;
CREATE OR REPLACE FUNCTION "public".framework_asset_id_seq() 
RETURNS BIGINT AS $$
DECLARE
    timestamp_part BIGINT;
    sequence_part BIGINT;
    random_part BIGINT;
BEGIN
    -- 获取当前时间戳（毫秒）
    timestamp_part := (extract(epoch from current_timestamp) * 1000)::BIGINT;
    
    -- 获取序列号
    sequence_part := nextval('"public".framework_asset_id_seq') % 512;
    
    -- 获取随机数部分
    random_part := nextval('"public".framework_asset_id_seq_seed') % 512;
    
    -- 组合TSID：41位时间戳 + 9位序列号 + 9位随机数
    RETURN (timestamp_part << 18) | (sequence_part << 9) | random_part;
END;
$$ LANGUAGE plpgsql;
-- ********
-- Table "framework_asset"
-- ********
DO $$
DECLARE
    column_rec RECORD;
    v_constraint_name TEXT;
    v_unique_constraint_name TEXT; 
    v_check_constraint_name TEXT;
BEGIN
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'framework_asset') THEN
        -- 删除所有CHECK约束
        FOR v_check_constraint_name IN 
            SELECT conname
            FROM pg_constraint con
            JOIN pg_class rel ON rel.oid = con.conrelid
            JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
            WHERE nsp.nspname = 'public'
                AND rel.relname = 'framework_asset'
                AND con.contype = 'c'
        LOOP
            EXECUTE 'ALTER TABLE "public"."framework_asset" DROP CONSTRAINT IF EXISTS ' || quote_ident(v_check_constraint_name);
        END LOOP;

        -- Check for any extra columns, and delete them if there are any.
        -- 检查是否有多余的列，如果有则删除。
        FOR column_rec IN SELECT tbl.column_name, tbl.data_type 
            FROM information_schema.columns tbl 
            WHERE table_schema = 'public' 
            AND table_name = 'framework_asset' 
        LOOP
            IF column_rec.column_name NOT IN ('id','owner_id','name','git_url','version','status','remark','created_at','last_at','deleted_at') THEN
                EXECUTE 'ALTER TABLE "public"."framework_asset" DROP COLUMN IF EXISTS ' || 
                        quote_ident(column_rec.column_name) || ' CASCADE';
            END IF;
        END LOOP;

        -- Check for missing columns, and add them if any are missing.
        -- 检查是否缺少列，如果缺少则添加
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'framework_asset' AND column_name = 'id' ) THEN
            ALTER TABLE "public"."framework_asset" ADD COLUMN "id" int8 NOT NULL DEFAULT framework_asset_id_seq();
        ELSE
            
            ALTER TABLE "public"."framework_asset" ALTER COLUMN "id" SET NOT NULL; 
            ALTER TABLE "public"."framework_asset" ALTER COLUMN "id" SET DEFAULT framework_asset_id_seq(); ALTER TABLE "public"."framework_asset" ALTER COLUMN "id" TYPE int8 USING "id"::int8;
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'framework_asset' AND column_name = 'owner_id' ) THEN
            ALTER TABLE "public"."framework_asset" ADD COLUMN "owner_id" uuid;
        ELSE
            
            ALTER TABLE "public"."framework_asset" ALTER COLUMN "owner_id" DROP NOT NULL; 
            ALTER TABLE "public"."framework_asset" ALTER COLUMN "owner_id" DROP DEFAULT; ALTER TABLE "public"."framework_asset" ALTER COLUMN "owner_id" TYPE uuid USING "owner_id"::uuid;
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'framework_asset' AND column_name = 'name' ) THEN
            ALTER TABLE "public"."framework_asset" ADD COLUMN "name" varchar(255) NOT NULL;
        ELSE
            
            ALTER TABLE "public"."framework_asset" ALTER COLUMN "name" SET NOT NULL; 
            ALTER TABLE "public"."framework_asset" ALTER COLUMN "name" DROP DEFAULT; ALTER TABLE "public"."framework_asset" ALTER COLUMN "name" TYPE varchar(255) USING "name"::varchar(255);
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'framework_asset' AND column_name = 'git_url' ) THEN
            ALTER TABLE "public"."framework_asset" ADD COLUMN "git_url" varchar(512);
        ELSE
            
            ALTER TABLE "public"."framework_asset" ALTER COLUMN "git_url" DROP NOT NULL; 
            ALTER TABLE "public"."framework_asset" ALTER COLUMN "git_url" DROP DEFAULT; ALTER TABLE "public"."framework_asset" ALTER COLUMN "git_url" TYPE varchar(512) USING "git_url"::varchar(512);
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'framework_asset' AND column_name = 'version' ) THEN
            ALTER TABLE "public"."framework_asset" ADD COLUMN "version" varchar(64);
        ELSE
            
            ALTER TABLE "public"."framework_asset" ALTER COLUMN "version" DROP NOT NULL; 
            ALTER TABLE "public"."framework_asset" ALTER COLUMN "version" DROP DEFAULT; ALTER TABLE "public"."framework_asset" ALTER COLUMN "version" TYPE varchar(64) USING "version"::varchar(64);
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'framework_asset' AND column_name = 'status' ) THEN
            ALTER TABLE "public"."framework_asset" ADD COLUMN "status" int2 DEFAULT 1;
        ELSE
            
            ALTER TABLE "public"."framework_asset" ALTER COLUMN "status" DROP NOT NULL; 
            ALTER TABLE "public"."framework_asset" ALTER COLUMN "status" SET DEFAULT 1; ALTER TABLE "public"."framework_asset" ALTER COLUMN "status" TYPE int2 USING "status"::int2;
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'framework_asset' AND column_name = 'remark' ) THEN
            ALTER TABLE "public"."framework_asset" ADD COLUMN "remark" varchar(1024);
        ELSE
            
            ALTER TABLE "public"."framework_asset" ALTER COLUMN "remark" DROP NOT NULL; 
            ALTER TABLE "public"."framework_asset" ALTER COLUMN "remark" DROP DEFAULT; ALTER TABLE "public"."framework_asset" ALTER COLUMN "remark" TYPE varchar(1024) USING "remark"::varchar(1024);
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'framework_asset' AND column_name = 'created_at' ) THEN
            ALTER TABLE "public"."framework_asset" ADD COLUMN "created_at" timestamptz(6) DEFAULT CURRENT_TIMESTAMP;
        ELSE
            
            ALTER TABLE "public"."framework_asset" ALTER COLUMN "created_at" DROP NOT NULL; 
            ALTER TABLE "public"."framework_asset" ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP; ALTER TABLE "public"."framework_asset" ALTER COLUMN "created_at" TYPE timestamptz(6) USING "created_at"::timestamptz(6);
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'framework_asset' AND column_name = 'last_at' ) THEN
            ALTER TABLE "public"."framework_asset" ADD COLUMN "last_at" timestamptz(6) DEFAULT CURRENT_TIMESTAMP;
        ELSE
            
            ALTER TABLE "public"."framework_asset" ALTER COLUMN "last_at" DROP NOT NULL; 
            ALTER TABLE "public"."framework_asset" ALTER COLUMN "last_at" SET DEFAULT CURRENT_TIMESTAMP; ALTER TABLE "public"."framework_asset" ALTER COLUMN "last_at" TYPE timestamptz(6) USING "last_at"::timestamptz(6);
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'framework_asset' AND column_name = 'deleted_at' ) THEN
            ALTER TABLE "public"."framework_asset" ADD COLUMN "deleted_at" timestamptz(6) DEFAULT NULL;
        ELSE
            
            ALTER TABLE "public"."framework_asset" ALTER COLUMN "deleted_at" DROP NOT NULL; 
            ALTER TABLE "public"."framework_asset" ALTER COLUMN "deleted_at" SET DEFAULT NULL; ALTER TABLE "public"."framework_asset" ALTER COLUMN "deleted_at" TYPE timestamptz(6) USING "deleted_at"::timestamptz(6);
        END IF;

        -- Search for existing unique and primary key constraints and drop them
        -- 查找并删除现有的唯一约束和主键约束
        BEGIN
            -- Drop primary key constraint
            -- 删除主键约束
            SELECT conname INTO v_constraint_name
            FROM pg_constraint con
            JOIN pg_class rel ON rel.oid = con.conrelid
            JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
            WHERE nsp.nspname = 'public'
                AND rel.relname = 'framework_asset'
                AND con.contype = 'p';
            IF v_constraint_name IS NOT NULL THEN
                EXECUTE 'ALTER TABLE "public"."framework_asset" DROP CONSTRAINT IF EXISTS ' || quote_ident(v_constraint_name) || ' CASCADE';
            END IF;

            -- Drop unique constraints
            -- 删除唯一约束
            FOR v_unique_constraint_name IN 
                SELECT conname
                FROM pg_constraint con
                JOIN pg_class rel ON rel.oid = con.conrelid
                JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
                WHERE nsp.nspname = 'public'
                    AND rel.relname = 'framework_asset'
                    AND con.contype = 'u'
            LOOP
                BEGIN
                    EXECUTE 'ALTER TABLE "public"."framework_asset" DROP CONSTRAINT IF EXISTS ' || quote_ident(v_unique_constraint_name);
                EXCEPTION WHEN OTHERS THEN
                    RAISE NOTICE 'Error dropping unique constraint %: %', v_unique_constraint_name, SQLERRM;
                END;
            END LOOP;
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'Error during dropping primary key or unique constraints: %', SQLERRM;
        END;

        -- 添加所有字段的CHECK约束
    ELSE
        -- If the table does not exist, then create the table.
        -- 如果表不存在，则创建表。
        CREATE TABLE "public"."framework_asset" (
            "id" int8 NOT NULL DEFAULT framework_asset_id_seq(),
            "owner_id" uuid,
            "name" varchar(255) NOT NULL,
            "git_url" varchar(512),
            "version" varchar(64),
            "status" int2 DEFAULT 1,
            "remark" varchar(1024),
            "created_at" timestamptz(6) DEFAULT CURRENT_TIMESTAMP,
            "last_at" timestamptz(6) DEFAULT CURRENT_TIMESTAMP,
            "deleted_at" timestamptz(6) DEFAULT NULL
        );
    END IF;
    -- Field Comment.
    -- 字段备注。
    COMMENT ON COLUMN "public"."framework_asset"."id" IS  '主键Id';
    COMMENT ON COLUMN "public"."framework_asset"."owner_id" IS  '所属用户Id';
    COMMENT ON COLUMN "public"."framework_asset"."name" IS  '资产名称';
    COMMENT ON COLUMN "public"."framework_asset"."git_url" IS  'Git地址';
    COMMENT ON COLUMN "public"."framework_asset"."version" IS  '版本';
    COMMENT ON COLUMN "public"."framework_asset"."status" IS  '状态';
    COMMENT ON COLUMN "public"."framework_asset"."remark" IS  '备注';
    COMMENT ON COLUMN "public"."framework_asset"."created_at" IS  '创建数据时间';
    COMMENT ON COLUMN "public"."framework_asset"."last_at" IS  '更新数据时间';
    COMMENT ON COLUMN "public"."framework_asset"."deleted_at" IS  '删除数据时间（逻辑删除）';
    -- Table Comment.
    -- 表备注。
    COMMENT ON TABLE "public"."framework_asset" IS '框架资产';

    -- Primary Key.
    -- 主键。
    BEGIN
        IF NOT EXISTS (
            SELECT 1
            FROM pg_constraint con
            JOIN pg_class rel ON rel.oid = con.conrelid
            JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
            WHERE nsp.nspname = 'public'
                AND rel.relname = 'framework_asset'
                AND con.contype = 'p'
        ) THEN
            BEGIN
                ALTER TABLE "public"."framework_asset" ADD CONSTRAINT framework_asset_pkey PRIMARY KEY ("id");
            EXCEPTION 
                WHEN duplicate_table THEN
                    RAISE NOTICE 'Primary key constraint already exists';
                WHEN OTHERS THEN
                    RAISE NOTICE 'Error adding primary key constraint: %', SQLERRM;
            END;
        END IF;
    END;

    -- Add unique constraints
    -- 添加唯一约束
    BEGIN
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'Error during adding unique constraints: %', SQLERRM;
    END;

    -- Add indexes
    -- 添加索引
    BEGIN
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'Error during adding indexes: %', SQLERRM;
    END;
END
$$;

-- ********
-- Sequence module_asset_id_seq
-- ********
DO $$ 
BEGIN     
    -- 创建基础序列
    CREATE SEQUENCE IF NOT EXISTS "public".module_asset_id_seq
        INCREMENT 1
        MINVALUE 1
        MAXVALUE 9223372036854775807
        START 1
        CACHE 1;
    -- 创建随机种子序列
    CREATE SEQUENCE IF NOT EXISTS "public"."module_asset_id_seq_seed"
    INCREMENT 1
    MINVALUE 1
    MAXVALUE 9223372036854775807
    START 1
    CACHE 1;
END $$;
CREATE OR REPLACE FUNCTION "public".module_asset_id_seq() 
RETURNS BIGINT AS $$
DECLARE
    timestamp_part BIGINT;
    sequence_part BIGINT;
    random_part BIGINT;
BEGIN
    -- 获取当前时间戳（毫秒）
    timestamp_part := (extract(epoch from current_timestamp) * 1000)::BIGINT;
    
    -- 获取序列号
    sequence_part := nextval('"public".module_asset_id_seq') % 512;
    
    -- 获取随机数部分
    random_part := nextval('"public".module_asset_id_seq_seed') % 512;
    
    -- 组合TSID：41位时间戳 + 9位序列号 + 9位随机数
    RETURN (timestamp_part << 18) | (sequence_part << 9) | random_part;
END;
$$ LANGUAGE plpgsql;
-- ********
-- Table "module_asset"
-- ********
DO $$
DECLARE
    column_rec RECORD;
    v_constraint_name TEXT;
    v_unique_constraint_name TEXT; 
    v_check_constraint_name TEXT;
BEGIN
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'module_asset') THEN
        -- 删除所有CHECK约束
        FOR v_check_constraint_name IN 
            SELECT conname
            FROM pg_constraint con
            JOIN pg_class rel ON rel.oid = con.conrelid
            JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
            WHERE nsp.nspname = 'public'
                AND rel.relname = 'module_asset'
                AND con.contype = 'c'
        LOOP
            EXECUTE 'ALTER TABLE "public"."module_asset" DROP CONSTRAINT IF EXISTS ' || quote_ident(v_check_constraint_name);
        END LOOP;

        -- Check for any extra columns, and delete them if there are any.
        -- 检查是否有多余的列，如果有则删除。
        FOR column_rec IN SELECT tbl.column_name, tbl.data_type 
            FROM information_schema.columns tbl 
            WHERE table_schema = 'public' 
            AND table_name = 'module_asset' 
        LOOP
            IF column_rec.column_name NOT IN ('id','owner_id','name','path','version','status','remark','created_at','last_at','deleted_at') THEN
                EXECUTE 'ALTER TABLE "public"."module_asset" DROP COLUMN IF EXISTS ' || 
                        quote_ident(column_rec.column_name) || ' CASCADE';
            END IF;
        END LOOP;

        -- Check for missing columns, and add them if any are missing.
        -- 检查是否缺少列，如果缺少则添加
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'module_asset' AND column_name = 'id' ) THEN
            ALTER TABLE "public"."module_asset" ADD COLUMN "id" int8 NOT NULL DEFAULT module_asset_id_seq();
        ELSE
            
            ALTER TABLE "public"."module_asset" ALTER COLUMN "id" SET NOT NULL; 
            ALTER TABLE "public"."module_asset" ALTER COLUMN "id" SET DEFAULT module_asset_id_seq(); ALTER TABLE "public"."module_asset" ALTER COLUMN "id" TYPE int8 USING "id"::int8;
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'module_asset' AND column_name = 'owner_id' ) THEN
            ALTER TABLE "public"."module_asset" ADD COLUMN "owner_id" uuid;
        ELSE
            
            ALTER TABLE "public"."module_asset" ALTER COLUMN "owner_id" DROP NOT NULL; 
            ALTER TABLE "public"."module_asset" ALTER COLUMN "owner_id" DROP DEFAULT; ALTER TABLE "public"."module_asset" ALTER COLUMN "owner_id" TYPE uuid USING "owner_id"::uuid;
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'module_asset' AND column_name = 'name' ) THEN
            ALTER TABLE "public"."module_asset" ADD COLUMN "name" varchar(255) NOT NULL;
        ELSE
            
            ALTER TABLE "public"."module_asset" ALTER COLUMN "name" SET NOT NULL; 
            ALTER TABLE "public"."module_asset" ALTER COLUMN "name" DROP DEFAULT; ALTER TABLE "public"."module_asset" ALTER COLUMN "name" TYPE varchar(255) USING "name"::varchar(255);
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'module_asset' AND column_name = 'path' ) THEN
            ALTER TABLE "public"."module_asset" ADD COLUMN "path" varchar(512);
        ELSE
            
            ALTER TABLE "public"."module_asset" ALTER COLUMN "path" DROP NOT NULL; 
            ALTER TABLE "public"."module_asset" ALTER COLUMN "path" DROP DEFAULT; ALTER TABLE "public"."module_asset" ALTER COLUMN "path" TYPE varchar(512) USING "path"::varchar(512);
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'module_asset' AND column_name = 'version' ) THEN
            ALTER TABLE "public"."module_asset" ADD COLUMN "version" varchar(64);
        ELSE
            
            ALTER TABLE "public"."module_asset" ALTER COLUMN "version" DROP NOT NULL; 
            ALTER TABLE "public"."module_asset" ALTER COLUMN "version" DROP DEFAULT; ALTER TABLE "public"."module_asset" ALTER COLUMN "version" TYPE varchar(64) USING "version"::varchar(64);
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'module_asset' AND column_name = 'status' ) THEN
            ALTER TABLE "public"."module_asset" ADD COLUMN "status" int2 DEFAULT 1;
        ELSE
            
            ALTER TABLE "public"."module_asset" ALTER COLUMN "status" DROP NOT NULL; 
            ALTER TABLE "public"."module_asset" ALTER COLUMN "status" SET DEFAULT 1; ALTER TABLE "public"."module_asset" ALTER COLUMN "status" TYPE int2 USING "status"::int2;
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'module_asset' AND column_name = 'remark' ) THEN
            ALTER TABLE "public"."module_asset" ADD COLUMN "remark" varchar(1024);
        ELSE
            
            ALTER TABLE "public"."module_asset" ALTER COLUMN "remark" DROP NOT NULL; 
            ALTER TABLE "public"."module_asset" ALTER COLUMN "remark" DROP DEFAULT; ALTER TABLE "public"."module_asset" ALTER COLUMN "remark" TYPE varchar(1024) USING "remark"::varchar(1024);
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'module_asset' AND column_name = 'created_at' ) THEN
            ALTER TABLE "public"."module_asset" ADD COLUMN "created_at" timestamptz(6) DEFAULT CURRENT_TIMESTAMP;
        ELSE
            
            ALTER TABLE "public"."module_asset" ALTER COLUMN "created_at" DROP NOT NULL; 
            ALTER TABLE "public"."module_asset" ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP; ALTER TABLE "public"."module_asset" ALTER COLUMN "created_at" TYPE timestamptz(6) USING "created_at"::timestamptz(6);
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'module_asset' AND column_name = 'last_at' ) THEN
            ALTER TABLE "public"."module_asset" ADD COLUMN "last_at" timestamptz(6) DEFAULT CURRENT_TIMESTAMP;
        ELSE
            
            ALTER TABLE "public"."module_asset" ALTER COLUMN "last_at" DROP NOT NULL; 
            ALTER TABLE "public"."module_asset" ALTER COLUMN "last_at" SET DEFAULT CURRENT_TIMESTAMP; ALTER TABLE "public"."module_asset" ALTER COLUMN "last_at" TYPE timestamptz(6) USING "last_at"::timestamptz(6);
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'module_asset' AND column_name = 'deleted_at' ) THEN
            ALTER TABLE "public"."module_asset" ADD COLUMN "deleted_at" timestamptz(6) DEFAULT NULL;
        ELSE
            
            ALTER TABLE "public"."module_asset" ALTER COLUMN "deleted_at" DROP NOT NULL; 
            ALTER TABLE "public"."module_asset" ALTER COLUMN "deleted_at" SET DEFAULT NULL; ALTER TABLE "public"."module_asset" ALTER COLUMN "deleted_at" TYPE timestamptz(6) USING "deleted_at"::timestamptz(6);
        END IF;

        -- Search for existing unique and primary key constraints and drop them
        -- 查找并删除现有的唯一约束和主键约束
        BEGIN
            -- Drop primary key constraint
            -- 删除主键约束
            SELECT conname INTO v_constraint_name
            FROM pg_constraint con
            JOIN pg_class rel ON rel.oid = con.conrelid
            JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
            WHERE nsp.nspname = 'public'
                AND rel.relname = 'module_asset'
                AND con.contype = 'p';
            IF v_constraint_name IS NOT NULL THEN
                EXECUTE 'ALTER TABLE "public"."module_asset" DROP CONSTRAINT IF EXISTS ' || quote_ident(v_constraint_name) || ' CASCADE';
            END IF;

            -- Drop unique constraints
            -- 删除唯一约束
            FOR v_unique_constraint_name IN 
                SELECT conname
                FROM pg_constraint con
                JOIN pg_class rel ON rel.oid = con.conrelid
                JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
                WHERE nsp.nspname = 'public'
                    AND rel.relname = 'module_asset'
                    AND con.contype = 'u'
            LOOP
                BEGIN
                    EXECUTE 'ALTER TABLE "public"."module_asset" DROP CONSTRAINT IF EXISTS ' || quote_ident(v_unique_constraint_name);
                EXCEPTION WHEN OTHERS THEN
                    RAISE NOTICE 'Error dropping unique constraint %: %', v_unique_constraint_name, SQLERRM;
                END;
            END LOOP;
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'Error during dropping primary key or unique constraints: %', SQLERRM;
        END;

        -- 添加所有字段的CHECK约束
    ELSE
        -- If the table does not exist, then create the table.
        -- 如果表不存在，则创建表。
        CREATE TABLE "public"."module_asset" (
            "id" int8 NOT NULL DEFAULT module_asset_id_seq(),
            "owner_id" uuid,
            "name" varchar(255) NOT NULL,
            "path" varchar(512),
            "version" varchar(64),
            "status" int2 DEFAULT 1,
            "remark" varchar(1024),
            "created_at" timestamptz(6) DEFAULT CURRENT_TIMESTAMP,
            "last_at" timestamptz(6) DEFAULT CURRENT_TIMESTAMP,
            "deleted_at" timestamptz(6) DEFAULT NULL
        );
    END IF;
    -- Field Comment.
    -- 字段备注。
    COMMENT ON COLUMN "public"."module_asset"."id" IS  '主键Id';
    COMMENT ON COLUMN "public"."module_asset"."owner_id" IS  '所属用户Id';
    COMMENT ON COLUMN "public"."module_asset"."name" IS  '模块名称';
    COMMENT ON COLUMN "public"."module_asset"."path" IS  '源码路径';
    COMMENT ON COLUMN "public"."module_asset"."version" IS  '版本';
    COMMENT ON COLUMN "public"."module_asset"."status" IS  '状态';
    COMMENT ON COLUMN "public"."module_asset"."remark" IS  '备注';
    COMMENT ON COLUMN "public"."module_asset"."created_at" IS  '创建数据时间';
    COMMENT ON COLUMN "public"."module_asset"."last_at" IS  '更新数据时间';
    COMMENT ON COLUMN "public"."module_asset"."deleted_at" IS  '删除数据时间（逻辑删除）';
    -- Table Comment.
    -- 表备注。
    COMMENT ON TABLE "public"."module_asset" IS '代码模块资产';

    -- Primary Key.
    -- 主键。
    BEGIN
        IF NOT EXISTS (
            SELECT 1
            FROM pg_constraint con
            JOIN pg_class rel ON rel.oid = con.conrelid
            JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
            WHERE nsp.nspname = 'public'
                AND rel.relname = 'module_asset'
                AND con.contype = 'p'
        ) THEN
            BEGIN
                ALTER TABLE "public"."module_asset" ADD CONSTRAINT module_asset_pkey PRIMARY KEY ("id");
            EXCEPTION 
                WHEN duplicate_table THEN
                    RAISE NOTICE 'Primary key constraint already exists';
                WHEN OTHERS THEN
                    RAISE NOTICE 'Error adding primary key constraint: %', SQLERRM;
            END;
        END IF;
    END;

    -- Add unique constraints
    -- 添加唯一约束
    BEGIN
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'Error during adding unique constraints: %', SQLERRM;
    END;

    -- Add indexes
    -- 添加索引
    BEGIN
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'Error during adding indexes: %', SQLERRM;
    END;
END
$$;





-- ********
-- Add Foreign Key
-- ********
DO $$
BEGIN

END
$$;

-- ********
-- Create Triggers
-- ********

DO $$
DECLARE
    trigger_rec RECORD;
    func_rec RECORD; 
BEGIN
    -- 删除所有存在的触发器和关联函数
    FOR trigger_rec IN (
        SELECT tgname as trigger_name, 
               tgrelid::regclass as table_name,
               p.proname as function_name
        FROM pg_trigger t
        JOIN pg_proc p ON t.tgfoid = p.oid
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
    ) LOOP
        -- 删除触发器
        EXECUTE 'DROP TRIGGER IF EXISTS ' || quote_ident(trigger_rec.trigger_name) || 
                ' ON ' || trigger_rec.table_name;
        -- 删除关联的触发器函数 
        EXECUTE 'DROP FUNCTION IF EXISTS public.' || quote_ident(trigger_rec.function_name) || '()';
    END LOOP;
    -- 只为存在的表创建触发器
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'framework_asset') THEN
        -- Create trigger function
        EXECUTE 'CREATE OR REPLACE FUNCTION "public"."' || quote_ident('update_framework_asset_last_at_trigger_func') || '"()
            RETURNS TRIGGER AS $func$
            BEGIN
                NEW.last_at = CURRENT_TIMESTAMP; RETURN NEW;
            END;
            $func$ LANGUAGE plpgsql';

        -- Create trigger
        EXECUTE 'CREATE TRIGGER "' || quote_ident('update_framework_asset_last_at') || '"
                BEFORE UPDATE ON "public"."framework_asset"
                FOR EACH ROW
                EXECUTE FUNCTION "public"."update_framework_asset_last_at_trigger_func"()';
    END IF;
    -- 只为存在的表创建触发器
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'component_asset') THEN
        -- Create trigger function
        EXECUTE 'CREATE OR REPLACE FUNCTION "public"."' || quote_ident('update_component_asset_last_at_trigger_func') || '"()
            RETURNS TRIGGER AS $func$
            BEGIN
                NEW.last_at = CURRENT_TIMESTAMP; RETURN NEW;
            END;
            $func$ LANGUAGE plpgsql';

        -- Create trigger
        EXECUTE 'CREATE TRIGGER "' || quote_ident('update_component_asset_last_at') || '"
                BEFORE UPDATE ON "public"."component_asset"
                FOR EACH ROW
                EXECUTE FUNCTION "public"."update_component_asset_last_at_trigger_func"()';
    END IF;
    -- 只为存在的表创建触发器
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'module_asset') THEN
        -- Create trigger function
        EXECUTE 'CREATE OR REPLACE FUNCTION "public"."' || quote_ident('update_module_asset_last_at_trigger_func') || '"()
            RETURNS TRIGGER AS $func$
            BEGIN
                NEW.last_at = CURRENT_TIMESTAMP; RETURN NEW;
            END;
            $func$ LANGUAGE plpgsql';

        -- Create trigger
        EXECUTE 'CREATE TRIGGER "' || quote_ident('update_module_asset_last_at') || '"
                BEFORE UPDATE ON "public"."module_asset"
                FOR EACH ROW
                EXECUTE FUNCTION "public"."update_module_asset_last_at_trigger_func"()';
    END IF;
END;
$$;


