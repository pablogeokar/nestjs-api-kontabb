export class CreateClientDto {
    company_name: string;
    cnpj: string;
    emails?: string | string[];
}

export class UpdateClientDto {
    company_name?: string;
    emails?: string | string[];
}

export class BatchClientDto {
    clients: Array<{ cnpj: string; company_name: string }>;
}
