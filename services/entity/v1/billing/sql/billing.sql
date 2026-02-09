
/*
    Server Type: PostgreSQL
    Catalogs: billing
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
-- Sequence order_info_id_seq
-- ********
DO $$ 
BEGIN     
    -- 创建基础序列
    CREATE SEQUENCE IF NOT EXISTS "public".order_info_id_seq
        INCREMENT 1
        MINVALUE 1
        MAXVALUE 9223372036854775807
        START 1
        CACHE 1;
    -- 创建随机种子序列
    CREATE SEQUENCE IF NOT EXISTS "public"."order_info_id_seq_seed"
    INCREMENT 1
    MINVALUE 1
    MAXVALUE 9223372036854775807
    START 1
    CACHE 1;
END $$;
CREATE OR REPLACE FUNCTION "public".order_info_id_seq() 
RETURNS BIGINT AS $$
DECLARE
    timestamp_part BIGINT;
    sequence_part BIGINT;
    random_part BIGINT;
BEGIN
    -- 获取当前时间戳（毫秒）
    timestamp_part := (extract(epoch from current_timestamp) * 1000)::BIGINT;
    
    -- 获取序列号
    sequence_part := nextval('"public".order_info_id_seq') % 512;
    
    -- 获取随机数部分
    random_part := nextval('"public".order_info_id_seq_seed') % 512;
    
    -- 组合TSID：41位时间戳 + 9位序列号 + 9位随机数
    RETURN (timestamp_part << 18) | (sequence_part << 9) | random_part;
END;
$$ LANGUAGE plpgsql;
-- ********
-- Table "order_info"
-- ********
DO $$
DECLARE
    column_rec RECORD;
    v_constraint_name TEXT;
    v_unique_constraint_name TEXT; 
    v_check_constraint_name TEXT;
BEGIN
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'order_info') THEN
        -- 删除所有CHECK约束
        FOR v_check_constraint_name IN 
            SELECT conname
            FROM pg_constraint con
            JOIN pg_class rel ON rel.oid = con.conrelid
            JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
            WHERE nsp.nspname = 'public'
                AND rel.relname = 'order_info'
                AND con.contype = 'c'
        LOOP
            EXECUTE 'ALTER TABLE "public"."order_info" DROP CONSTRAINT IF EXISTS ' || quote_ident(v_check_constraint_name);
        END LOOP;

        -- Check for any extra columns, and delete them if there are any.
        -- 检查是否有多余的列，如果有则删除。
        FOR column_rec IN SELECT tbl.column_name, tbl.data_type 
            FROM information_schema.columns tbl 
            WHERE table_schema = 'public' 
            AND table_name = 'order_info' 
        LOOP
            IF column_rec.column_name NOT IN ('id','user_id','order_no','order_type','status','total_amount','created_at','last_at','deleted_at') THEN
                EXECUTE 'ALTER TABLE "public"."order_info" DROP COLUMN IF EXISTS ' || 
                        quote_ident(column_rec.column_name) || ' CASCADE';
            END IF;
        END LOOP;

        -- Check for missing columns, and add them if any are missing.
        -- 检查是否缺少列，如果缺少则添加
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'order_info' AND column_name = 'id' ) THEN
            ALTER TABLE "public"."order_info" ADD COLUMN "id" int8 NOT NULL DEFAULT order_info_id_seq();
        ELSE
            
            ALTER TABLE "public"."order_info" ALTER COLUMN "id" SET NOT NULL; 
            ALTER TABLE "public"."order_info" ALTER COLUMN "id" SET DEFAULT order_info_id_seq(); ALTER TABLE "public"."order_info" ALTER COLUMN "id" TYPE int8 USING "id"::int8;
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'order_info' AND column_name = 'user_id' ) THEN
            ALTER TABLE "public"."order_info" ADD COLUMN "user_id" uuid NOT NULL;
        ELSE
            
            ALTER TABLE "public"."order_info" ALTER COLUMN "user_id" SET NOT NULL; 
            ALTER TABLE "public"."order_info" ALTER COLUMN "user_id" DROP DEFAULT; ALTER TABLE "public"."order_info" ALTER COLUMN "user_id" TYPE uuid USING "user_id"::uuid;
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'order_info' AND column_name = 'order_no' ) THEN
            ALTER TABLE "public"."order_info" ADD COLUMN "order_no" varchar(128) NOT NULL;
        ELSE
            
            ALTER TABLE "public"."order_info" ALTER COLUMN "order_no" SET NOT NULL; 
            ALTER TABLE "public"."order_info" ALTER COLUMN "order_no" DROP DEFAULT; ALTER TABLE "public"."order_info" ALTER COLUMN "order_no" TYPE varchar(128) USING "order_no"::varchar(128);
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'order_info' AND column_name = 'order_type' ) THEN
            ALTER TABLE "public"."order_info" ADD COLUMN "order_type" int2 DEFAULT 1;
        ELSE
            
            ALTER TABLE "public"."order_info" ALTER COLUMN "order_type" DROP NOT NULL; 
            ALTER TABLE "public"."order_info" ALTER COLUMN "order_type" SET DEFAULT 1; ALTER TABLE "public"."order_info" ALTER COLUMN "order_type" TYPE int2 USING "order_type"::int2;
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'order_info' AND column_name = 'status' ) THEN
            ALTER TABLE "public"."order_info" ADD COLUMN "status" int2 DEFAULT 1;
        ELSE
            
            ALTER TABLE "public"."order_info" ALTER COLUMN "status" DROP NOT NULL; 
            ALTER TABLE "public"."order_info" ALTER COLUMN "status" SET DEFAULT 1; ALTER TABLE "public"."order_info" ALTER COLUMN "status" TYPE int2 USING "status"::int2;
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'order_info' AND column_name = 'total_amount' ) THEN
            ALTER TABLE "public"."order_info" ADD COLUMN "total_amount" int8 DEFAULT 0;
        ELSE
            
            ALTER TABLE "public"."order_info" ALTER COLUMN "total_amount" DROP NOT NULL; 
            ALTER TABLE "public"."order_info" ALTER COLUMN "total_amount" SET DEFAULT 0; ALTER TABLE "public"."order_info" ALTER COLUMN "total_amount" TYPE int8 USING "total_amount"::int8;
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'order_info' AND column_name = 'created_at' ) THEN
            ALTER TABLE "public"."order_info" ADD COLUMN "created_at" timestamptz(6) DEFAULT CURRENT_TIMESTAMP;
        ELSE
            
            ALTER TABLE "public"."order_info" ALTER COLUMN "created_at" DROP NOT NULL; 
            ALTER TABLE "public"."order_info" ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP; ALTER TABLE "public"."order_info" ALTER COLUMN "created_at" TYPE timestamptz(6) USING "created_at"::timestamptz(6);
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'order_info' AND column_name = 'last_at' ) THEN
            ALTER TABLE "public"."order_info" ADD COLUMN "last_at" timestamptz(6) DEFAULT CURRENT_TIMESTAMP;
        ELSE
            
            ALTER TABLE "public"."order_info" ALTER COLUMN "last_at" DROP NOT NULL; 
            ALTER TABLE "public"."order_info" ALTER COLUMN "last_at" SET DEFAULT CURRENT_TIMESTAMP; ALTER TABLE "public"."order_info" ALTER COLUMN "last_at" TYPE timestamptz(6) USING "last_at"::timestamptz(6);
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'order_info' AND column_name = 'deleted_at' ) THEN
            ALTER TABLE "public"."order_info" ADD COLUMN "deleted_at" timestamptz(6) DEFAULT NULL;
        ELSE
            
            ALTER TABLE "public"."order_info" ALTER COLUMN "deleted_at" DROP NOT NULL; 
            ALTER TABLE "public"."order_info" ALTER COLUMN "deleted_at" SET DEFAULT NULL; ALTER TABLE "public"."order_info" ALTER COLUMN "deleted_at" TYPE timestamptz(6) USING "deleted_at"::timestamptz(6);
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
                AND rel.relname = 'order_info'
                AND con.contype = 'p';
            IF v_constraint_name IS NOT NULL THEN
                EXECUTE 'ALTER TABLE "public"."order_info" DROP CONSTRAINT IF EXISTS ' || quote_ident(v_constraint_name) || ' CASCADE';
            END IF;

            -- Drop unique constraints
            -- 删除唯一约束
            FOR v_unique_constraint_name IN 
                SELECT conname
                FROM pg_constraint con
                JOIN pg_class rel ON rel.oid = con.conrelid
                JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
                WHERE nsp.nspname = 'public'
                    AND rel.relname = 'order_info'
                    AND con.contype = 'u'
            LOOP
                BEGIN
                    EXECUTE 'ALTER TABLE "public"."order_info" DROP CONSTRAINT IF EXISTS ' || quote_ident(v_unique_constraint_name);
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
        CREATE TABLE "public"."order_info" (
            "id" int8 NOT NULL DEFAULT order_info_id_seq(),
            "user_id" uuid NOT NULL,
            "order_no" varchar(128) NOT NULL,
            "order_type" int2 DEFAULT 1,
            "status" int2 DEFAULT 1,
            "total_amount" int8 DEFAULT 0,
            "created_at" timestamptz(6) DEFAULT CURRENT_TIMESTAMP,
            "last_at" timestamptz(6) DEFAULT CURRENT_TIMESTAMP,
            "deleted_at" timestamptz(6) DEFAULT NULL
        );
    END IF;
    -- Field Comment.
    -- 字段备注。
    COMMENT ON COLUMN "public"."order_info"."id" IS  '主键Id';
    COMMENT ON COLUMN "public"."order_info"."user_id" IS  '用户Id';
    COMMENT ON COLUMN "public"."order_info"."order_no" IS  '订单号';
    COMMENT ON COLUMN "public"."order_info"."order_type" IS  '订单类型';
    COMMENT ON COLUMN "public"."order_info"."status" IS  '订单状态';
    COMMENT ON COLUMN "public"."order_info"."total_amount" IS  '订单总金额';
    COMMENT ON COLUMN "public"."order_info"."created_at" IS  '创建数据时间';
    COMMENT ON COLUMN "public"."order_info"."last_at" IS  '更新数据时间';
    COMMENT ON COLUMN "public"."order_info"."deleted_at" IS  '删除数据时间（逻辑删除）';
    -- Table Comment.
    -- 表备注。
    COMMENT ON TABLE "public"."order_info" IS '订单信息';

    -- Primary Key.
    -- 主键。
    BEGIN
        IF NOT EXISTS (
            SELECT 1
            FROM pg_constraint con
            JOIN pg_class rel ON rel.oid = con.conrelid
            JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
            WHERE nsp.nspname = 'public'
                AND rel.relname = 'order_info'
                AND con.contype = 'p'
        ) THEN
            BEGIN
                ALTER TABLE "public"."order_info" ADD CONSTRAINT order_info_pkey PRIMARY KEY ("id");
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
-- Sequence order_item_id_seq
-- ********
DO $$ 
BEGIN     
    -- 创建基础序列
    CREATE SEQUENCE IF NOT EXISTS "public".order_item_id_seq
        INCREMENT 1
        MINVALUE 1
        MAXVALUE 9223372036854775807
        START 1
        CACHE 1;
    -- 创建随机种子序列
    CREATE SEQUENCE IF NOT EXISTS "public"."order_item_id_seq_seed"
    INCREMENT 1
    MINVALUE 1
    MAXVALUE 9223372036854775807
    START 1
    CACHE 1;
END $$;
CREATE OR REPLACE FUNCTION "public".order_item_id_seq() 
RETURNS BIGINT AS $$
DECLARE
    timestamp_part BIGINT;
    sequence_part BIGINT;
    random_part BIGINT;
BEGIN
    -- 获取当前时间戳（毫秒）
    timestamp_part := (extract(epoch from current_timestamp) * 1000)::BIGINT;
    
    -- 获取序列号
    sequence_part := nextval('"public".order_item_id_seq') % 512;
    
    -- 获取随机数部分
    random_part := nextval('"public".order_item_id_seq_seed') % 512;
    
    -- 组合TSID：41位时间戳 + 9位序列号 + 9位随机数
    RETURN (timestamp_part << 18) | (sequence_part << 9) | random_part;
END;
$$ LANGUAGE plpgsql;
-- ********
-- Table "order_item"
-- ********
DO $$
DECLARE
    column_rec RECORD;
    v_constraint_name TEXT;
    v_unique_constraint_name TEXT; 
    v_check_constraint_name TEXT;
BEGIN
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'order_item') THEN
        -- 删除所有CHECK约束
        FOR v_check_constraint_name IN 
            SELECT conname
            FROM pg_constraint con
            JOIN pg_class rel ON rel.oid = con.conrelid
            JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
            WHERE nsp.nspname = 'public'
                AND rel.relname = 'order_item'
                AND con.contype = 'c'
        LOOP
            EXECUTE 'ALTER TABLE "public"."order_item" DROP CONSTRAINT IF EXISTS ' || quote_ident(v_check_constraint_name);
        END LOOP;

        -- Check for any extra columns, and delete them if there are any.
        -- 检查是否有多余的列，如果有则删除。
        FOR column_rec IN SELECT tbl.column_name, tbl.data_type 
            FROM information_schema.columns tbl 
            WHERE table_schema = 'public' 
            AND table_name = 'order_item' 
        LOOP
            IF column_rec.column_name NOT IN ('id','order_id','agent_code','quantity','item_amount','created_at','last_at','deleted_at') THEN
                EXECUTE 'ALTER TABLE "public"."order_item" DROP COLUMN IF EXISTS ' || 
                        quote_ident(column_rec.column_name) || ' CASCADE';
            END IF;
        END LOOP;

        -- Check for missing columns, and add them if any are missing.
        -- 检查是否缺少列，如果缺少则添加
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'order_item' AND column_name = 'id' ) THEN
            ALTER TABLE "public"."order_item" ADD COLUMN "id" int8 NOT NULL DEFAULT order_item_id_seq();
        ELSE
            
            ALTER TABLE "public"."order_item" ALTER COLUMN "id" SET NOT NULL; 
            ALTER TABLE "public"."order_item" ALTER COLUMN "id" SET DEFAULT order_item_id_seq(); ALTER TABLE "public"."order_item" ALTER COLUMN "id" TYPE int8 USING "id"::int8;
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'order_item' AND column_name = 'order_id' ) THEN
            ALTER TABLE "public"."order_item" ADD COLUMN "order_id" int8 NOT NULL;
        ELSE
            
            ALTER TABLE "public"."order_item" ALTER COLUMN "order_id" SET NOT NULL; 
            ALTER TABLE "public"."order_item" ALTER COLUMN "order_id" DROP DEFAULT; ALTER TABLE "public"."order_item" ALTER COLUMN "order_id" TYPE int8 USING "order_id"::int8;
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'order_item' AND column_name = 'agent_code' ) THEN
            ALTER TABLE "public"."order_item" ADD COLUMN "agent_code" varchar(128) NOT NULL;
        ELSE
            
            ALTER TABLE "public"."order_item" ALTER COLUMN "agent_code" SET NOT NULL; 
            ALTER TABLE "public"."order_item" ALTER COLUMN "agent_code" DROP DEFAULT; ALTER TABLE "public"."order_item" ALTER COLUMN "agent_code" TYPE varchar(128) USING "agent_code"::varchar(128);
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'order_item' AND column_name = 'quantity' ) THEN
            ALTER TABLE "public"."order_item" ADD COLUMN "quantity" int4 DEFAULT 1;
        ELSE
            
            ALTER TABLE "public"."order_item" ALTER COLUMN "quantity" DROP NOT NULL; 
            ALTER TABLE "public"."order_item" ALTER COLUMN "quantity" SET DEFAULT 1; ALTER TABLE "public"."order_item" ALTER COLUMN "quantity" TYPE int4 USING "quantity"::int4;
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'order_item' AND column_name = 'item_amount' ) THEN
            ALTER TABLE "public"."order_item" ADD COLUMN "item_amount" int8 DEFAULT 0;
        ELSE
            
            ALTER TABLE "public"."order_item" ALTER COLUMN "item_amount" DROP NOT NULL; 
            ALTER TABLE "public"."order_item" ALTER COLUMN "item_amount" SET DEFAULT 0; ALTER TABLE "public"."order_item" ALTER COLUMN "item_amount" TYPE int8 USING "item_amount"::int8;
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'order_item' AND column_name = 'created_at' ) THEN
            ALTER TABLE "public"."order_item" ADD COLUMN "created_at" timestamptz(6) DEFAULT CURRENT_TIMESTAMP;
        ELSE
            
            ALTER TABLE "public"."order_item" ALTER COLUMN "created_at" DROP NOT NULL; 
            ALTER TABLE "public"."order_item" ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP; ALTER TABLE "public"."order_item" ALTER COLUMN "created_at" TYPE timestamptz(6) USING "created_at"::timestamptz(6);
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'order_item' AND column_name = 'last_at' ) THEN
            ALTER TABLE "public"."order_item" ADD COLUMN "last_at" timestamptz(6) DEFAULT CURRENT_TIMESTAMP;
        ELSE
            
            ALTER TABLE "public"."order_item" ALTER COLUMN "last_at" DROP NOT NULL; 
            ALTER TABLE "public"."order_item" ALTER COLUMN "last_at" SET DEFAULT CURRENT_TIMESTAMP; ALTER TABLE "public"."order_item" ALTER COLUMN "last_at" TYPE timestamptz(6) USING "last_at"::timestamptz(6);
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'order_item' AND column_name = 'deleted_at' ) THEN
            ALTER TABLE "public"."order_item" ADD COLUMN "deleted_at" timestamptz(6) DEFAULT NULL;
        ELSE
            
            ALTER TABLE "public"."order_item" ALTER COLUMN "deleted_at" DROP NOT NULL; 
            ALTER TABLE "public"."order_item" ALTER COLUMN "deleted_at" SET DEFAULT NULL; ALTER TABLE "public"."order_item" ALTER COLUMN "deleted_at" TYPE timestamptz(6) USING "deleted_at"::timestamptz(6);
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
                AND rel.relname = 'order_item'
                AND con.contype = 'p';
            IF v_constraint_name IS NOT NULL THEN
                EXECUTE 'ALTER TABLE "public"."order_item" DROP CONSTRAINT IF EXISTS ' || quote_ident(v_constraint_name) || ' CASCADE';
            END IF;

            -- Drop unique constraints
            -- 删除唯一约束
            FOR v_unique_constraint_name IN 
                SELECT conname
                FROM pg_constraint con
                JOIN pg_class rel ON rel.oid = con.conrelid
                JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
                WHERE nsp.nspname = 'public'
                    AND rel.relname = 'order_item'
                    AND con.contype = 'u'
            LOOP
                BEGIN
                    EXECUTE 'ALTER TABLE "public"."order_item" DROP CONSTRAINT IF EXISTS ' || quote_ident(v_unique_constraint_name);
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
        CREATE TABLE "public"."order_item" (
            "id" int8 NOT NULL DEFAULT order_item_id_seq(),
            "order_id" int8 NOT NULL,
            "agent_code" varchar(128) NOT NULL,
            "quantity" int4 DEFAULT 1,
            "item_amount" int8 DEFAULT 0,
            "created_at" timestamptz(6) DEFAULT CURRENT_TIMESTAMP,
            "last_at" timestamptz(6) DEFAULT CURRENT_TIMESTAMP,
            "deleted_at" timestamptz(6) DEFAULT NULL
        );
    END IF;
    -- Field Comment.
    -- 字段备注。
    COMMENT ON COLUMN "public"."order_item"."id" IS  '主键Id';
    COMMENT ON COLUMN "public"."order_item"."order_id" IS  '订单Id';
    COMMENT ON COLUMN "public"."order_item"."agent_code" IS  '智能体编码';
    COMMENT ON COLUMN "public"."order_item"."quantity" IS  '购买数量';
    COMMENT ON COLUMN "public"."order_item"."item_amount" IS  '明细金额';
    COMMENT ON COLUMN "public"."order_item"."created_at" IS  '创建数据时间';
    COMMENT ON COLUMN "public"."order_item"."last_at" IS  '更新数据时间';
    COMMENT ON COLUMN "public"."order_item"."deleted_at" IS  '删除数据时间（逻辑删除）';
    -- Table Comment.
    -- 表备注。
    COMMENT ON TABLE "public"."order_item" IS '订单项';

    -- Primary Key.
    -- 主键。
    BEGIN
        IF NOT EXISTS (
            SELECT 1
            FROM pg_constraint con
            JOIN pg_class rel ON rel.oid = con.conrelid
            JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
            WHERE nsp.nspname = 'public'
                AND rel.relname = 'order_item'
                AND con.contype = 'p'
        ) THEN
            BEGIN
                ALTER TABLE "public"."order_item" ADD CONSTRAINT order_item_pkey PRIMARY KEY ("id");
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
-- Sequence subscription_id_seq
-- ********
DO $$ 
BEGIN     
    -- 创建基础序列
    CREATE SEQUENCE IF NOT EXISTS "public".subscription_id_seq
        INCREMENT 1
        MINVALUE 1
        MAXVALUE 9223372036854775807
        START 1
        CACHE 1;
    -- 创建随机种子序列
    CREATE SEQUENCE IF NOT EXISTS "public"."subscription_id_seq_seed"
    INCREMENT 1
    MINVALUE 1
    MAXVALUE 9223372036854775807
    START 1
    CACHE 1;
END $$;
CREATE OR REPLACE FUNCTION "public".subscription_id_seq() 
RETURNS BIGINT AS $$
DECLARE
    timestamp_part BIGINT;
    sequence_part BIGINT;
    random_part BIGINT;
BEGIN
    -- 获取当前时间戳（毫秒）
    timestamp_part := (extract(epoch from current_timestamp) * 1000)::BIGINT;
    
    -- 获取序列号
    sequence_part := nextval('"public".subscription_id_seq') % 512;
    
    -- 获取随机数部分
    random_part := nextval('"public".subscription_id_seq_seed') % 512;
    
    -- 组合TSID：41位时间戳 + 9位序列号 + 9位随机数
    RETURN (timestamp_part << 18) | (sequence_part << 9) | random_part;
END;
$$ LANGUAGE plpgsql;
-- ********
-- Table "subscription"
-- ********
DO $$
DECLARE
    column_rec RECORD;
    v_constraint_name TEXT;
    v_unique_constraint_name TEXT; 
    v_check_constraint_name TEXT;
BEGIN
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'subscription') THEN
        -- 删除所有CHECK约束
        FOR v_check_constraint_name IN 
            SELECT conname
            FROM pg_constraint con
            JOIN pg_class rel ON rel.oid = con.conrelid
            JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
            WHERE nsp.nspname = 'public'
                AND rel.relname = 'subscription'
                AND con.contype = 'c'
        LOOP
            EXECUTE 'ALTER TABLE "public"."subscription" DROP CONSTRAINT IF EXISTS ' || quote_ident(v_check_constraint_name);
        END LOOP;

        -- Check for any extra columns, and delete them if there are any.
        -- 检查是否有多余的列，如果有则删除。
        FOR column_rec IN SELECT tbl.column_name, tbl.data_type 
            FROM information_schema.columns tbl 
            WHERE table_schema = 'public' 
            AND table_name = 'subscription' 
        LOOP
            IF column_rec.column_name NOT IN ('id','user_id','plan_code','status','duration','created_at','last_at','deleted_at') THEN
                EXECUTE 'ALTER TABLE "public"."subscription" DROP COLUMN IF EXISTS ' || 
                        quote_ident(column_rec.column_name) || ' CASCADE';
            END IF;
        END LOOP;

        -- Check for missing columns, and add them if any are missing.
        -- 检查是否缺少列，如果缺少则添加
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'subscription' AND column_name = 'id' ) THEN
            ALTER TABLE "public"."subscription" ADD COLUMN "id" int8 NOT NULL DEFAULT subscription_id_seq();
        ELSE
            
            ALTER TABLE "public"."subscription" ALTER COLUMN "id" SET NOT NULL; 
            ALTER TABLE "public"."subscription" ALTER COLUMN "id" SET DEFAULT subscription_id_seq(); ALTER TABLE "public"."subscription" ALTER COLUMN "id" TYPE int8 USING "id"::int8;
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'subscription' AND column_name = 'user_id' ) THEN
            ALTER TABLE "public"."subscription" ADD COLUMN "user_id" uuid NOT NULL;
        ELSE
            
            ALTER TABLE "public"."subscription" ALTER COLUMN "user_id" SET NOT NULL; 
            ALTER TABLE "public"."subscription" ALTER COLUMN "user_id" DROP DEFAULT; ALTER TABLE "public"."subscription" ALTER COLUMN "user_id" TYPE uuid USING "user_id"::uuid;
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'subscription' AND column_name = 'plan_code' ) THEN
            ALTER TABLE "public"."subscription" ADD COLUMN "plan_code" varchar(128) NOT NULL;
        ELSE
            
            ALTER TABLE "public"."subscription" ALTER COLUMN "plan_code" SET NOT NULL; 
            ALTER TABLE "public"."subscription" ALTER COLUMN "plan_code" DROP DEFAULT; ALTER TABLE "public"."subscription" ALTER COLUMN "plan_code" TYPE varchar(128) USING "plan_code"::varchar(128);
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'subscription' AND column_name = 'status' ) THEN
            ALTER TABLE "public"."subscription" ADD COLUMN "status" int2 DEFAULT 1;
        ELSE
            
            ALTER TABLE "public"."subscription" ALTER COLUMN "status" DROP NOT NULL; 
            ALTER TABLE "public"."subscription" ALTER COLUMN "status" SET DEFAULT 1; ALTER TABLE "public"."subscription" ALTER COLUMN "status" TYPE int2 USING "status"::int2;
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'subscription' AND column_name = 'duration' ) THEN
            ALTER TABLE "public"."subscription" ADD COLUMN "duration" int4 DEFAULT 0;
        ELSE
            
            ALTER TABLE "public"."subscription" ALTER COLUMN "duration" DROP NOT NULL; 
            ALTER TABLE "public"."subscription" ALTER COLUMN "duration" SET DEFAULT 0; ALTER TABLE "public"."subscription" ALTER COLUMN "duration" TYPE int4 USING "duration"::int4;
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'subscription' AND column_name = 'created_at' ) THEN
            ALTER TABLE "public"."subscription" ADD COLUMN "created_at" timestamptz(6) DEFAULT CURRENT_TIMESTAMP;
        ELSE
            
            ALTER TABLE "public"."subscription" ALTER COLUMN "created_at" DROP NOT NULL; 
            ALTER TABLE "public"."subscription" ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP; ALTER TABLE "public"."subscription" ALTER COLUMN "created_at" TYPE timestamptz(6) USING "created_at"::timestamptz(6);
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'subscription' AND column_name = 'last_at' ) THEN
            ALTER TABLE "public"."subscription" ADD COLUMN "last_at" timestamptz(6) DEFAULT CURRENT_TIMESTAMP;
        ELSE
            
            ALTER TABLE "public"."subscription" ALTER COLUMN "last_at" DROP NOT NULL; 
            ALTER TABLE "public"."subscription" ALTER COLUMN "last_at" SET DEFAULT CURRENT_TIMESTAMP; ALTER TABLE "public"."subscription" ALTER COLUMN "last_at" TYPE timestamptz(6) USING "last_at"::timestamptz(6);
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'subscription' AND column_name = 'deleted_at' ) THEN
            ALTER TABLE "public"."subscription" ADD COLUMN "deleted_at" timestamptz(6) DEFAULT NULL;
        ELSE
            
            ALTER TABLE "public"."subscription" ALTER COLUMN "deleted_at" DROP NOT NULL; 
            ALTER TABLE "public"."subscription" ALTER COLUMN "deleted_at" SET DEFAULT NULL; ALTER TABLE "public"."subscription" ALTER COLUMN "deleted_at" TYPE timestamptz(6) USING "deleted_at"::timestamptz(6);
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
                AND rel.relname = 'subscription'
                AND con.contype = 'p';
            IF v_constraint_name IS NOT NULL THEN
                EXECUTE 'ALTER TABLE "public"."subscription" DROP CONSTRAINT IF EXISTS ' || quote_ident(v_constraint_name) || ' CASCADE';
            END IF;

            -- Drop unique constraints
            -- 删除唯一约束
            FOR v_unique_constraint_name IN 
                SELECT conname
                FROM pg_constraint con
                JOIN pg_class rel ON rel.oid = con.conrelid
                JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
                WHERE nsp.nspname = 'public'
                    AND rel.relname = 'subscription'
                    AND con.contype = 'u'
            LOOP
                BEGIN
                    EXECUTE 'ALTER TABLE "public"."subscription" DROP CONSTRAINT IF EXISTS ' || quote_ident(v_unique_constraint_name);
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
        CREATE TABLE "public"."subscription" (
            "id" int8 NOT NULL DEFAULT subscription_id_seq(),
            "user_id" uuid NOT NULL,
            "plan_code" varchar(128) NOT NULL,
            "status" int2 DEFAULT 1,
            "duration" int4 DEFAULT 0,
            "created_at" timestamptz(6) DEFAULT CURRENT_TIMESTAMP,
            "last_at" timestamptz(6) DEFAULT CURRENT_TIMESTAMP,
            "deleted_at" timestamptz(6) DEFAULT NULL
        );
    END IF;
    -- Field Comment.
    -- 字段备注。
    COMMENT ON COLUMN "public"."subscription"."id" IS  '主键Id';
    COMMENT ON COLUMN "public"."subscription"."user_id" IS  '用户Id';
    COMMENT ON COLUMN "public"."subscription"."plan_code" IS  '订阅方案编码';
    COMMENT ON COLUMN "public"."subscription"."status" IS  '状态';
    COMMENT ON COLUMN "public"."subscription"."duration" IS  '订阅时长';
    COMMENT ON COLUMN "public"."subscription"."created_at" IS  '创建数据时间';
    COMMENT ON COLUMN "public"."subscription"."last_at" IS  '更新数据时间';
    COMMENT ON COLUMN "public"."subscription"."deleted_at" IS  '删除数据时间（逻辑删除）';
    -- Table Comment.
    -- 表备注。
    COMMENT ON TABLE "public"."subscription" IS '订阅信息';

    -- Primary Key.
    -- 主键。
    BEGIN
        IF NOT EXISTS (
            SELECT 1
            FROM pg_constraint con
            JOIN pg_class rel ON rel.oid = con.conrelid
            JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
            WHERE nsp.nspname = 'public'
                AND rel.relname = 'subscription'
                AND con.contype = 'p'
        ) THEN
            BEGIN
                ALTER TABLE "public"."subscription" ADD CONSTRAINT subscription_pkey PRIMARY KEY ("id");
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
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'subscription') THEN
        -- Create trigger function
        EXECUTE 'CREATE OR REPLACE FUNCTION "public"."' || quote_ident('update_subscription_last_at_trigger_func') || '"()
            RETURNS TRIGGER AS $func$
            BEGIN
                NEW.last_at = CURRENT_TIMESTAMP; RETURN NEW;
            END;
            $func$ LANGUAGE plpgsql';

        -- Create trigger
        EXECUTE 'CREATE TRIGGER "' || quote_ident('update_subscription_last_at') || '"
                BEFORE UPDATE ON "public"."subscription"
                FOR EACH ROW
                EXECUTE FUNCTION "public"."update_subscription_last_at_trigger_func"()';
    END IF;
    -- 只为存在的表创建触发器
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'order_info') THEN
        -- Create trigger function
        EXECUTE 'CREATE OR REPLACE FUNCTION "public"."' || quote_ident('update_order_info_last_at_trigger_func') || '"()
            RETURNS TRIGGER AS $func$
            BEGIN
                NEW.last_at = CURRENT_TIMESTAMP; RETURN NEW;
            END;
            $func$ LANGUAGE plpgsql';

        -- Create trigger
        EXECUTE 'CREATE TRIGGER "' || quote_ident('update_order_info_last_at') || '"
                BEFORE UPDATE ON "public"."order_info"
                FOR EACH ROW
                EXECUTE FUNCTION "public"."update_order_info_last_at_trigger_func"()';
    END IF;
    -- 只为存在的表创建触发器
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'order_item') THEN
        -- Create trigger function
        EXECUTE 'CREATE OR REPLACE FUNCTION "public"."' || quote_ident('update_order_item_last_at_trigger_func') || '"()
            RETURNS TRIGGER AS $func$
            BEGIN
                NEW.last_at = CURRENT_TIMESTAMP; RETURN NEW;
            END;
            $func$ LANGUAGE plpgsql';

        -- Create trigger
        EXECUTE 'CREATE TRIGGER "' || quote_ident('update_order_item_last_at') || '"
                BEFORE UPDATE ON "public"."order_item"
                FOR EACH ROW
                EXECUTE FUNCTION "public"."update_order_item_last_at_trigger_func"()';
    END IF;
END;
$$;


