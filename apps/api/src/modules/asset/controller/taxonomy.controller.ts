// taxonomy.controller.ts serves locations and categories. They share a shape,
// but stay two controllers so each route reads plainly in Swagger.
import {
  Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { NotFoundException } from '@nestjs/common';
import { TenantRole } from '../../../common/constants/roles';
import { Roles } from '../../../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { Category } from '../models/category.model';
import { Location } from '../models/location.model';
import {
  CreateCategoryInput, CreateLocationInput,
  createCategorySchema, createLocationSchema,
  updateCategorySchema, updateLocationSchema,
} from '../schemas/taxonomy.schema';

@ApiTags('locations')
@Controller('locations')
export class LocationController {
  constructor(@InjectModel(Location) private readonly locations: typeof Location) {}

  @Get()
  @ApiOperation({ summary: 'All locations' })
  list() {
    return this.locations.findAll({ order: [['name', 'ASC']] });
  }

  @Post()
  @Roles(TenantRole.ADMIN)
  @ApiOperation({ summary: 'Add a location' })
  create(
    @Body(new ZodValidationPipe(createLocationSchema)) body: CreateLocationInput,
  ) {
    return this.locations.create(body as any);
  }

  @Patch(':id')
  @Roles(TenantRole.ADMIN)
  @ApiOperation({ summary: 'Rename or deactivate a location' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateLocationSchema)) body: Record<string, unknown>,
  ) {
    const location = await this.locations.findByPk(id);
    if (!location) throw new NotFoundException('Location not found');
    return location.update(body as any);
  }

  @Delete(':id')
  @Roles(TenantRole.ADMIN)
  @HttpCode(204)
  @ApiOperation({ summary: 'Deactivate a location' })
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    const location = await this.locations.findByPk(id);
    if (!location) throw new NotFoundException('Location not found');
    // Deactivated, not deleted: assets still point at it and their history has
    // to keep naming where they were.
    await location.update({ isActive: false });
  }
}

@ApiTags('categories')
@Controller('categories')
export class CategoryController {
  constructor(@InjectModel(Category) private readonly categories: typeof Category) {}

  @Get()
  @ApiOperation({ summary: 'All categories' })
  list() {
    return this.categories.findAll({ order: [['name', 'ASC']] });
  }

  @Post()
  @Roles(TenantRole.ADMIN)
  @ApiOperation({ summary: 'Add a category' })
  create(
    @Body(new ZodValidationPipe(createCategorySchema)) body: CreateCategoryInput,
  ) {
    return this.categories.create(body as any);
  }

  @Patch(':id')
  @Roles(TenantRole.ADMIN)
  @ApiOperation({ summary: 'Edit a category' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateCategorySchema)) body: Record<string, unknown>,
  ) {
    const category = await this.categories.findByPk(id);
    if (!category) throw new NotFoundException('Category not found');
    return category.update(body as any);
  }
}
