import React from "react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import { ResourceList, ResourceItem, Badge } from "@shopify/polaris";

/**
 * SortableList Component
 *
 * IMPORTANT: This component requires @dnd-kit packages and @shopify/polaris.
 * Install with:
 *   npm install @dnd-kit/core @dnd-kit/sortable @dnd-kit/modifiers @shopify/polaris
 *
 * Example usage:
 * ```tsx
 * import { SortableList } from "@/feature/bite/components/templates/SortableList/SortableList";
 *
 * const [items, setItems] = useState([
 *   { id: "1", title: "Item 1", status: "active" },
 *   { id: "2", title: "Item 2", status: "draft" },
 * ]);
 *
 * <SortableList items={items} setItems={setItems} />
 * ```
 */

export interface SortableItem {
  id: string | number;
  title: string;
  status?: "active" | "draft" | string;
  [key: string]: any;
}

export interface SortableListProps {
  items: SortableItem[];
  setItems: (items: SortableItem[] | ((prev: SortableItem[]) => SortableItem[])) => void;
}

export const SortableList: React.FC<SortableListProps> = ({ items, setItems }) => {
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  function handleDragEnd(event: any) {
    const { active, over } = event;

    if (active.id !== over.id) {
      setItems((items) => {
        const oldIndex = items.findIndex((item) => item.id === active.id);
        const newIndex = items.findIndex((item) => item.id === over.id);
        return arrayMove(items, oldIndex, newIndex);
      });
    }
  }

  function SortableItem({ id, item }: { id: string | number; item: SortableItem }) {
    const {
      attributes,
      listeners,
      setNodeRef,
      transform,
      transition,
    } = useSortable({ id });

    const style = {
      transform: CSS.Transform.toString(transform),
      transition,
      touchAction: "none",
    };

    return (
      <div ref={setNodeRef} style={style}>
        <ResourceItem
          id={id.toString()}
          accessibilityLabel={`View details for ${item.title}`}
          onClick={() => {}}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
            <div {...attributes} {...listeners} style={{ cursor: "grab" }}>
              ☰
            </div>
            <div style={{ flex: 1 }}>
              <h3>{item.title}</h3>
              {item.status && <Badge>{item.status}</Badge>}
            </div>
          </div>
        </ResourceItem>
      </div>
    );
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
      modifiers={[restrictToVerticalAxis]}
    >
      <SortableContext
        items={items.map((item) => item.id)}
        strategy={verticalListSortingStrategy}
      >
        <ResourceList
          resourceName={{ singular: "item", plural: "items" }}
          items={items}
          renderItem={(item) => (
            <SortableItem key={item.id} id={item.id} item={item} />
          )}
        />
      </SortableContext>
    </DndContext>
  );
};
