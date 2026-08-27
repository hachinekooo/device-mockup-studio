type SegmentedProps<T extends string | number> = {
  options: { id: T; label: React.ReactNode; title?: string }[]
  value: T
  onChange: (id: T) => void
  size?: 'sm' | 'md'
}

export function Segmented<T extends string | number>({ options, value, onChange, size = 'md' }: SegmentedProps<T>) {
  return (
    <div className={`segmented segmented-${size}`}>
      {options.map((o) => (
        <button
          key={o.id}
          title={o.title}
          className={o.id === value ? 'segment active' : 'segment'}
          onClick={() => onChange(o.id)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
