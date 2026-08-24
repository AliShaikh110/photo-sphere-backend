import type {
  CreationOptional,
  ForeignKey,
  InferAttributes,
  InferCreationAttributes,
  NonAttribute,
  Sequelize} from 'sequelize';
import {
  DataTypes,
  Model
} from 'sequelize';

import type { Asset } from './asset.model';
import { emptyJsonObject, PLAN_COORDINATE_SYSTEMS } from './model.types';
import type { JsonObject, PlanCoordinateSystem } from './model.types';
import type { Project } from './project.model';

/** A floor or site plan image that scenes can be positioned on. */
export class Plan extends Model<InferAttributes<Plan>, InferCreationAttributes<Plan>> {
  declare id: CreationOptional<string>;
  declare projectId: ForeignKey<Project['id']>;
  declare name: string;
  declare assetId: ForeignKey<Asset['id']> | null;
  declare coordinateSystem: CreationOptional<PlanCoordinateSystem>;
  declare metadata: CreationOptional<JsonObject>;
  declare sortOrder: CreationOptional<number>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;

  declare project?: NonAttribute<Project>;
  declare asset?: NonAttribute<Asset>;

  static initialize(sequelize: Sequelize): typeof Plan {
    if (sequelize.models.Plan === Plan) {
      return Plan;
    }

    Plan.init(
      {
        id: {
          type: DataTypes.UUID,
          allowNull: false,
          defaultValue: DataTypes.UUIDV4,
          primaryKey: true,
        },
        projectId: {
          type: DataTypes.UUID,
          allowNull: false,
          field: 'project_id',
        },
        name: {
          type: DataTypes.STRING(255),
          allowNull: false,
          validate: { notEmpty: true },
        },
        assetId: {
          type: DataTypes.UUID,
          allowNull: true,
          field: 'asset_id',
        },
        coordinateSystem: {
          type: DataTypes.STRING(32),
          allowNull: false,
          defaultValue: 'plan_normalized',
          field: 'coordinate_system',
          validate: { isIn: [PLAN_COORDINATE_SYSTEMS] },
        },
        metadata: {
          type: DataTypes.JSONB,
          allowNull: false,
          defaultValue: emptyJsonObject,
        },
        sortOrder: {
          type: DataTypes.INTEGER,
          allowNull: false,
          defaultValue: 0,
          field: 'sort_order',
          validate: { min: 0 },
        },
        createdAt: DataTypes.DATE,
        updatedAt: DataTypes.DATE,
      },
      {
        sequelize,
        modelName: 'Plan',
        tableName: 'plans',
        underscored: true,
        indexes: [
          { name: 'plans_project_sort_idx', fields: ['project_id', 'sort_order'] },
          { name: 'plans_asset_idx', fields: ['asset_id'] },
        ],
      },
    );

    return Plan;
  }
}
