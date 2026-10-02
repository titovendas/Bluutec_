import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Users,
  Package,
  ShoppingCart,
  UserCircle,
  TrendingUp,
  ArrowRight,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getDashboardStats } from "@/lib/sales.functions";
import { formatCurrency, formatDate, statusLabel, statusVariant } from "@/lib/sales-formatters";

export const Route = createFileRoute("/_authenticated/")({
  component: DashboardPage,
  head: () => ({
    meta: [
      { title: "Dashboard | Força de Vendas" },
      {
        name: "description",
        content: "Visão geral do sistema de força de vendas.",
      },
    ],
  }),
});

function DashboardPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["dashboard-stats"],
    queryFn: () => getDashboardStats(),
  });

  if (isLoading || !data) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center text-muted-foreground">
        Carregando...
      </div>
    );
  }

  const stats = [
    {
      title: "Clientes",
      value: data.customersCount,
      icon: Users,
      href: "/clientes",
    },
    {
      title: "Produtos",
      value: data.productsCount,
      icon: Package,
      href: "/produtos",
    },
    {
      title: "Vendedores",
      value: data.sellersCount,
      icon: UserCircle,
      href: "/vendedores",
    },
    {
      title: "Pedidos",
      value: data.ordersCount,
      icon: ShoppingCart,
      href: "/pedidos",
    },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground">
          Visão geral do seu sistema de vendas.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <Card key={stat.title}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {stat.title}
              </CardTitle>
              <stat.icon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stat.value}</div>
              <Link
                to={stat.href}
                className="mt-2 inline-flex items-center text-xs text-primary hover:underline"
              >
                Ver todos <ArrowRight className="ml-1 h-3 w-3" />
              </Link>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Pedidos recentes</CardTitle>
            <p className="text-sm text-muted-foreground">
              Últimos pedidos realizados no sistema.
            </p>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link to="/pedidos">Ver todos</Link>
          </Button>
        </CardHeader>
        <CardContent>
          {data.recentOrders.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <ShoppingCart className="h-10 w-10 text-muted-foreground/60" />
              <h3 className="mt-4 text-lg font-medium">Nenhum pedido ainda</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Crie seu primeiro pedido para começar.
              </p>
              <Button asChild className="mt-4">
                <Link to="/pedidos">Novo pedido</Link>
              </Button>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Vendedor</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead>Data</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.recentOrders.map((order: any) => (
                  <TableRow key={order.id}>
                    <TableCell className="font-medium">
                      {order.customer_name || "—"}
                    </TableCell>
                    <TableCell>{order.seller_name || "—"}</TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(order.status)}>
                        {statusLabel(order.status)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {formatCurrency(order.calculated_total)}
                    </TableCell>
                    <TableCell>{formatDate(order.created_at)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
