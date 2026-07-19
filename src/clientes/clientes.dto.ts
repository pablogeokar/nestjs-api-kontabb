import { Type } from 'class-transformer';
import {
    ArrayMaxSize,
    IsArray,
    IsEmail,
    IsIn,
    IsOptional,
    IsString,
    Length,
    Matches,
    ValidateIf,
    ValidateNested,
} from 'class-validator';

export type ClientType = 'PF' | 'PJ';

export class CreateClientDto {
    @IsIn(['PF', 'PJ'])
    tipo_pessoa: ClientType = 'PJ';

    @IsString()
    @Length(1, 160)
    company_name: string;

    @ValidateIf((dto: CreateClientDto) => dto.tipo_pessoa === 'PJ')
    @IsString()
    @Matches(/^\d{14}$/, { message: 'CNPJ deve conter 14 dígitos.' })
    cnpj?: string;

    @ValidateIf((dto: CreateClientDto) => dto.tipo_pessoa === 'PF')
    @IsString()
    @Matches(/^\d{11}$/, { message: 'CPF deve conter 11 dígitos.' })
    cpf?: string;

    @IsOptional()
    @IsEmail({}, { each: true })
    emails?: string | string[];
}

export class UpdateClientDto {
    @IsOptional()
    @IsString()
    @Length(1, 160)
    company_name?: string;

    @IsOptional()
    @IsEmail({}, { each: true })
    emails?: string | string[];
}

export class BatchClientItemDto {
    @IsString()
    @Matches(/^\d{14}$/, { message: 'CNPJ deve conter 14 dígitos.' })
    cnpj: string;

    @IsString()
    @Length(1, 160)
    company_name: string;
}

export class BatchClientDto {
    @IsArray()
    @ArrayMaxSize(100)
    @ValidateNested({ each: true })
    @Type(() => BatchClientItemDto)
    clients: BatchClientItemDto[];
}
